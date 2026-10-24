import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Conversation, widgetApi } from "./api";
import { loadStored, newVisitorId, saveStored } from "./storage";
import { STRINGS } from "./strings";
import type { ChatMessage, Handoff, LeadFormFields } from "./types";

let lastId = 0;
const newId = () => `m${++lastId}`;

/**
 * One visitor's conversation with a chatbot (M4-3). The server keeps the
 * history (D-2 §3): a message sends only its own text, and the answer
 * streams back word by word. The conversation and its token are kept in
 * localStorage, so a reload or the next page of the site shows the same
 * chat; an expired or unknown one is dropped and the next message starts
 * a new conversation.
 *
 * It also says when the visitor can be asked for a rating (M5-7): once the
 * conversation has a complete answer and hasn't been rated yet.
 */
export function useChat(publicId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Sent, and no word of the answer yet: the typing dots. */
  const [waiting, setWaiting] = useState(false);
  /** Sent, and the answer is not complete: no new message until it is. */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const conversationRef = useRef<Conversation | null>(null);
  /** The conversation has at least one complete answer from the bot. */
  const [answered, setAnswered] = useState(false);
  const [rated, setRated] = useState(false);
  /** The server says the visitor has answered the follow-up: ask for the rating now. */
  const [ratingRequested, setRatingRequested] = useState(false);

  const forget = () => {
    conversationRef.current = null;
    setAnswered(false);
    setRated(false);
    setRatingRequested(false);
    const { visitorId } = loadStored(publicId);
    saveStored(publicId, { visitorId });
  };

  // A reloaded page picks the conversation up again.
  useEffect(() => {
    const { conversation, rated: ratedId } = loadStored(publicId);
    if (!conversation) return;
    conversationRef.current = conversation;
    setRated(ratedId === conversation.conversationId);
    let cancelled = false;
    widgetApi.history(conversation).then(
      (rows) => {
        if (cancelled) return;
        if (rows.some((r) => r.role === "assistant")) setAnswered(true);
        setMessages((current) => [
          ...rows.map((r) => ({ id: newId(), role: r.role, text: r.text })),
          ...current,
        ]);
      },
      (err: unknown) => {
        // Gone or expired (the token lasts a day): start anew on send.
        if (!cancelled && isGone(err)) forget();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  /** The open conversation, or a new one. */
  async function conversation(): Promise<Conversation> {
    if (conversationRef.current) return conversationRef.current;
    const stored = loadStored(publicId);
    const visitorId = stored.visitorId ?? newVisitorId();
    const started = await widgetApi.startConversation(publicId, visitorId, hostPage());
    const chat = {
      conversationId: started.conversationId,
      conversationToken: started.conversationToken,
    };
    conversationRef.current = chat;
    saveStored(publicId, { visitorId, conversation: chat });
    return chat;
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setWaiting(true);
    const answerId = newId();
    let answer = "";
    let handoff: Handoff | undefined;
    let leadForm = false;
    let followUp = "";
    let streaming = true;
    setMessages((current) => [...current, { id: newId(), role: "user", text: message }]);

    const showAnswer = () =>
      setMessages((current) => {
        const shown: ChatMessage = { id: answerId, role: "assistant", text: answer, streaming, handoff, leadForm };
        return current.some((m) => m.id === answerId)
          ? current.map((m) => (m.id === answerId ? shown : m))
          : [...current, shown];
      });

    try {
      const chat = await conversation();
      await widgetApi.send(chat, message, (event) => {
        if (event.type === "delta") {
          answer += event.text;
          setWaiting(false);
          showAnswer();
        } else if (event.type === "handoff") {
          // Only after a fallback answer, when the company set a way to reach them.
          handoff = { kind: event.kind, value: event.value, label: event.label };
        } else if (event.type === "lead_form") {
          // The visitor wants to buy or book: the contact form comes with this answer.
          leadForm = true;
        } else if (event.type === "follow_up") {
          // A second message right after this answer (it gave contact details).
          followUp = event.text;
        } else if (event.type === "rating_prompt") {
          setRatingRequested(true);
        } else if (event.type === "error") {
          throw new ApiError(event.message, 200);
        }
      });
      if (!answer) throw new ApiError("The chat gave no answer", 200);
      // Complete: the end is no longer cut mid-mark, and the handoff shows.
      streaming = false;
      showAnswer();
      if (followUp) {
        setMessages((current) => [...current, { id: newId(), role: "assistant", text: followUp }]);
      }
      setAnswered(true);
    } catch (err) {
      if (isGone(err)) forget();
      // A broken answer is not stored, so none of it stays on screen.
      setMessages((current) => [
        ...current.filter((m) => m.id !== answerId),
        { id: newId(), role: "assistant", text: errorText(err) },
      ]);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setWaiting(false);
    }
  }

  /**
   * The contact form's submit (M7-41): saves a lead in this conversation,
   * then swaps the form for a thank-you. Throws when the API refuses, so the
   * form can say so and stay.
   */
  async function submitLead(fields: LeadFormFields) {
    const chat = conversationRef.current;
    if (!chat) throw new ApiError("There is no conversation yet", 404);
    try {
      await widgetApi.lead(chat, fields);
    } catch (err) {
      if (isGone(err)) forget();
      throw err;
    }
    setMessages((current) => [
      ...current.map((m) => (m.leadForm ? { ...m, leadForm: false } : m)),
      { id: newId(), role: "assistant", text: STRINGS.leadForm.thanks },
    ]);
  }

  /**
   * Sends the visitor's stars and remembers that this conversation is
   * rated. A failed call is let go: the visitor already saw the thanks.
   */
  async function rate(stars: number) {
    const chat = conversationRef.current;
    if (!chat) return;
    setRated(true);
    saveStored(publicId, { ...loadStored(publicId), rated: chat.conversationId });
    await widgetApi.rate(chat, stars).catch(() => undefined);
  }

  return { messages, waiting, busy, send, answered, rated, ratingRequested, rate, submitLead };
}

/** The conversation no longer exists for this visitor. */
function isGone(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 404);
}

function errorText(err: unknown): string {
  return err instanceof ApiError && err.status === 429 ? STRINGS.tooFast : STRINGS.somethingWrong;
}

/**
 * The company's page the chat starts on, for the conversation list (M5).
 * In the iframe that is the referrer; only an http(s) URL the API accepts.
 */
function hostPage(): string | undefined {
  const url = document.referrer;
  return /^https?:\/\//.test(url) && url.length <= 500 ? url : undefined;
}
