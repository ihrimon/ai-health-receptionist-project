"use client";

import type { ChatbotConfig, LauncherIcon } from "@brainstack/shared";
import { CircleQuestionMark, Minus, MessageSquare, SendHorizontal, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { previewBrand, previewIcon, previewTitle } from "@/lib/appearance";

/** The same icons the loader draws on the company's site (apps/widget/src/loader). */
export const LAUNCHER_ICON_COMPONENTS: Record<LauncherIcon, typeof MessageSquare> = {
  chat: MessageSquare,
  sparkle: Sparkles,
  help: CircleQuestionMark,
};

/**
 * A live, static picture of the widget on a company's page (M4-12,
 * FR-3.6): the launcher in its corner and the chat window above it, both
 * drawn from the editor's unsaved draft, so every change shows at once.
 * Clicking the launcher hides or shows the window, like on the site.
 */
export function WidgetPreview({ draft }: { draft: ChatbotConfig }) {
  const [open, setOpen] = useState(true);
  const { widget, identity } = draft;
  const brand = previewBrand(widget.primaryColor);
  const left = widget.position === "left";
  const Icon = open ? X : LAUNCHER_ICON_COMPONENTS[previewIcon(widget.launcherIcon)];

  return (
    <div className="grid gap-2">
      <div
        className="relative h-[480px] overflow-hidden rounded-xl border bg-muted/40"
      >
        {/* A stand-in for the company's page. */}
        <div className="grid gap-2 p-4" aria-hidden="true">
          <div className="h-3 w-1/3 rounded bg-muted-foreground/15" />
          <div className="h-2 w-3/4 rounded bg-muted-foreground/10" />
          <div className="h-2 w-2/3 rounded bg-muted-foreground/10" />
          <div className="mt-2 h-20 rounded-lg bg-muted-foreground/10" />
        </div>

        {open && (
          <div
            className={cn(
              "absolute bottom-[76px] flex h-[380px] w-[260px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-xl",
              left ? "left-3" : "right-3",
            )}
          >
            <div
              className="flex items-center justify-between px-3 py-2.5 text-sm font-semibold"
              style={brand}
            >
              <span className="truncate">
                {previewTitle(widget.headerTitle, identity.botName)}
              </span>
              <Minus className="size-4 shrink-0 opacity-80" aria-hidden="true" />
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3 text-xs">
              <p className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-zinc-100 px-3 py-2 break-words">
                {identity.welcomeMessage || "…"}
              </p>
              {widget.quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {widget.quickReplies.map((reply) => (
                    <span
                      key={reply}
                      className="max-w-full truncate rounded-full border px-2.5 py-1"
                      style={{ borderColor: brand.background, color: "#18181b" }}
                    >
                      {reply}
                    </span>
                  ))}
                </div>
              )}
              <p
                className="max-w-[85%] self-end rounded-2xl rounded-br-sm px-3 py-2"
                style={brand}
              >
                Do you deliver?
              </p>
            </div>
            <div className="flex items-center gap-2 border-t p-2">
              <span className="flex-1 truncate rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-500">
                Type a message…
              </span>
              <span
                className="flex size-7 items-center justify-center rounded-full"
                style={brand}
              >
                <SendHorizontal className="size-3.5" aria-hidden="true" />
              </span>
            </div>
            {widget.showBranding && (
              <p className="pb-1.5 text-center text-[10px] text-zinc-400">
                Powered by BrainStack
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Hide the chat in the preview" : "Show the chat in the preview"}
          className={cn(
            "absolute bottom-3 flex size-14 items-center justify-center rounded-full shadow-lg",
            left ? "left-3" : "right-3",
          )}
          style={brand}
        >
          <Icon className="size-6" aria-hidden="true" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Preview of your draft. Visitors see it after you publish.
      </p>
    </div>
  );
}
