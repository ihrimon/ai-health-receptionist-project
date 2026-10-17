"use client";

import type { ConversationDetail } from "@brainstack/shared";
import { ExternalLink, Star, Trash2, TriangleAlert } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDelete, EmptyState } from "@/components/knowledge/shared";
import { PageHeader } from "@/components/page-header";
import { TranscriptView } from "@/components/transcript-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, formatDateTime } from "@/lib/api";
import {
  conversationsApi,
  isSafeLink,
  originLabel,
  visitorLabel,
} from "@/lib/conversations";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * One conversation (D-3 §3.6, M5-2): the page it started on, its rating,
 * and the full transcript with the sources behind every answer. An owner
 * or admin can delete it for privacy (M5-3), after a confirm dialog.
 */
export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useSession();
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const canDelete = me.role === "OWNER" || me.role === "ADMIN";

  useEffect(() => {
    let cancelled = false;
    conversationsApi.get(id).then(
      (data) => {
        if (cancelled) return;
        setConversation(data);
        setMissing(false);
      },
      (err: Error) => {
        if (cancelled) return;
        // Another workspace's, deleted, or a bad link: all the same 404.
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
          setMissing(true);
        } else {
          toastError(err.message);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, me.activeWorkspace?.id]);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 sm:p-6">
      <PageHeader
        backHref="/app/conversations"
        title={conversation ? visitorLabel(conversation.visitorId) : "Conversation"}
        subtitle={conversation ? formatDateTime(conversation.startedAt) : undefined}
        actions={
          conversation && canDelete ? (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              <Trash2 /> Delete
            </Button>
          ) : undefined
        }
      />

      {missing ? (
        <EmptyState
          title="Conversation not found"
          example="It may have been deleted, or it belongs to another workspace."
        />
      ) : !conversation ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {conversation.originUrl ? (
              isSafeLink(conversation.originUrl) ? (
                <a
                  href={conversation.originUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-1 hover:underline"
                >
                  <span className="truncate">
                    from {originLabel(conversation.originUrl)}
                  </span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="truncate">from {originLabel(conversation.originUrl)}</span>
              )
            ) : (
              <span>Page not recorded</span>
            )}
            <span>{conversation.messageCount} messages</span>
            {conversation.rating !== null ? (
              <span className="flex items-center gap-1">
                <Star className="size-3.5" /> {conversation.rating} / 5
              </span>
            ) : (
              <span>Not rated</span>
            )}
            {conversation.hasFallback && (
              <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-500">
                <TriangleAlert className="size-3" /> The bot couldn&apos;t answer something
              </Badge>
            )}
          </div>
          <div className="rounded-lg border bg-muted/30 p-4">
            <TranscriptView messages={conversation.messages} />
          </div>
        </>
      )}

      <ConfirmDelete
        what={confirming ? "this conversation" : null}
        description="All of its messages are deleted for good. This can't be undone."
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await conversationsApi.remove(id);
          toastSuccess("Conversation deleted.");
          router.push("/app/conversations");
        }}
      />
    </div>
  );
}
