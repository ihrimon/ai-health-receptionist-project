"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { TranscriptView } from "@/components/transcript-view";
import { apiFetch, formatDateTime, type Conversation } from "@/lib/api";

export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Conversation>(`/conversations/${id}`)
      .then(setConversation)
      .catch((err) => setError(err.message));
  }, [id]);

  if (!conversation) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b p-4 sm:px-6">
        <PageHeader
          title="Conversation"
          subtitle={formatDateTime(conversation.createdAt)}
          backHref="/admin/conversations"
        />
      </div>

      <div className="chat-wallpaper min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <TranscriptView transcript={conversation.transcript} />
        </div>
      </div>
    </div>
  );
}
