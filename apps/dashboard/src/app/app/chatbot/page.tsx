"use client";

import Link from "next/link";
import { PreviewChat } from "@/components/chatbot-editor/preview-chat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useChatbot } from "@/lib/chatbot";

/**
 * Chatbot page: a full-size test chat (M3-13) with the saved draft and the
 * workspace's knowledge. The settings it answers with live under
 * /app/settings/chatbot.
 */
export default function ChatbotPage() {
  const { chatbot, error, refresh } = useChatbot();

  if (!chatbot) {
    return error ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your chatbot: {error}
        </p>
        <Button variant="outline" onClick={() => refresh().catch(() => {})}>
          Try again
        </Button>
      </div>
    ) : (
      <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 sm:p-6">
        <Skeleton className="h-[32rem] w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">
        Chat with your bot the way a visitor would.{" "}
        <Link href="/app/settings/chatbot" className="underline underline-offset-4 hover:text-foreground">
          Change its settings
        </Link>
      </p>
      <PreviewChat
        key={chatbot.id}
        welcomeMessage={chatbot.draftConfig.identity.welcomeMessage}
        className="h-auto min-h-[24rem] flex-1"
      />
    </div>
  );
}
