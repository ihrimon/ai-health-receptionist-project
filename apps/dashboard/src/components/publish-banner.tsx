"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useChatbot } from "@/lib/chatbot";
import { bannerState } from "@/lib/config-form";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * "Unpublished changes · Publish" in the header of every dashboard page
 * (D-3 §2, M2-20), shown while the draft differs from the live bot. When
 * publishing isn't possible yet, the button is disabled and hovering it
 * lists why. Viewers see the notice but no button.
 */
export function PublishBanner() {
  const { me } = useSession();
  const { chatbot, publish } = useChatbot();
  const [publishing, setPublishing] = useState(false);
  if (!chatbot) return null;

  const state = bannerState(chatbot);
  if (!state.show) return null;
  const canEdit = me.role === "OWNER" || me.role === "ADMIN";

  async function handlePublish() {
    setPublishing(true);
    try {
      await publish();
      toastSuccess("Published. Your chatbot is using the new settings.");
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  const button = (
    <Button
      size="sm"
      disabled={!state.canPublish || publishing}
      onClick={handlePublish}
    >
      {publishing ? "Publishing…" : "Publish"}
    </Button>
  );

  return (
    <div className="flex items-center gap-2">
      <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        <span className="size-2 rounded-full bg-amber-500" aria-hidden />
        {state.label}
      </span>
      {canEdit &&
        (state.canPublish ? (
          button
        ) : (
          <Tooltip>
            {/* A disabled button gets no hover, so the span carries it. */}
            <TooltipTrigger render={<span tabIndex={0} />}>
              {button}
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex-col items-start">
              <span className="flex items-center gap-1 font-medium">
                <CircleAlert className="size-3.5" />
                Before you can publish:
              </span>
              {state.reasons.map((reason) => (
                <span key={reason}>• {reason}</span>
              ))}
            </TooltipContent>
          </Tooltip>
        ))}
    </div>
  );
}
