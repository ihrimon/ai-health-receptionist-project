"use client";

import { ArrowLeft, Eye } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { adminConsoleApi, type SupportView } from "@/lib/admin";
import { formatDateTime } from "@/lib/api";
import { toastError } from "@/lib/toast";

/**
 * Super-admin console, support view (M7-35): how one company set up its
 * chatbot and knowledge base, read-only. It never shows conversations,
 * messages or leads, and every visit is written to the audit log by the API.
 */
export default function AdminWorkspaceSupportPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<SupportView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminConsoleApi.supportView(id).then(
      (data) => !cancelled && setView(data),
      (err: Error & { status?: number }) => {
        if (cancelled) return;
        if (err.status === 404) setMissing(true);
        else toastError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 overflow-y-auto p-4 sm:p-6">
      <Link
        href="/admin/workspaces"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All workspaces
      </Link>

      {missing ? (
        <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          This workspace no longer exists.
        </p>
      ) : view === null ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{view.workspace.name}</h2>
            <p className="text-sm text-muted-foreground">
              {view.workspace.slug} · {view.workspace.plan.toLowerCase()} plan ·{" "}
              {view.workspace.status === "SUSPENDED" ? "suspended" : "active"}
            </p>
            <p className="mt-2 flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <Eye className="size-3.5 shrink-0" />
              Read-only. Conversations and leads are never shown here, and this
              visit was saved in the audit log.
            </p>
          </div>

          <section className="grid gap-1 rounded-lg border p-4 text-sm">
            <h3 className="text-lg font-semibold">Company</h3>
            {[
              ["Website", view.workspace.website],
              ["Industry", view.workspace.industry],
              ["Contact email", view.workspace.contactEmail],
              ["Contact phone", view.workspace.contactPhone],
              ["Time zone", view.workspace.timeZone],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-4">
                <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
                <span className="break-all">{value ?? "—"}</span>
              </div>
            ))}
          </section>

          <section className="grid gap-3">
            <h3 className="text-lg font-semibold">Chatbot</h3>
            {view.chatbots.length === 0 && (
              <p className="text-sm text-muted-foreground">No chatbot.</p>
            )}
            {view.chatbots.map((bot) => (
              <div key={bot.id} className="grid gap-2 rounded-lg border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={bot.status === "ENABLED" ? "secondary" : "outline"}>
                    {bot.status === "ENABLED" ? "Enabled" : "Disabled"}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{bot.publicId}</span>
                  <span className="text-muted-foreground">
                    {bot.publishedVersion
                      ? `Live: version ${bot.publishedVersion.version}, published ${formatDateTime(bot.publishedVersion.publishedAt)}`
                      : "Never published"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Allowed sites: </span>
                  {bot.allowedDomains.length > 0 ? bot.allowedDomains.join(", ") : "none yet"}
                </div>
                <div>
                  <span className="text-muted-foreground">Install verified: </span>
                  {bot.installVerifiedHost ?? "not yet"}
                </div>
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    Draft configuration
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                    {JSON.stringify(bot.draftConfig, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </section>

          <section className="grid gap-3">
            <h3 className="text-lg font-semibold">FAQs ({view.faqs.length})</h3>
            {view.faqs.length === 0 && (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
            {view.faqs.map((f) => (
              <div key={f.id} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{f.question}</div>
                <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{f.answer}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-3">
            <h3 className="text-lg font-semibold">Custom answers ({view.customAnswers.length})</h3>
            {view.customAnswers.length === 0 && (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
            {view.customAnswers.map((c) => (
              <div key={c.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {c.triggerQuestion}
                  {!c.isActive && <Badge variant="outline">Off</Badge>}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{c.answer}</div>
              </div>
            ))}
          </section>

          <section className="grid gap-3">
            <h3 className="text-lg font-semibold">Knowledge sources ({view.sources.length})</h3>
            {view.sources.length === 0 && (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
            {view.sources.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <span className="font-medium">{s.title}</span>
                <Badge variant="outline">{s.type.toLowerCase()}</Badge>
                <Badge variant={s.status === "FAILED" ? "destructive" : "secondary"}>
                  {s.status.toLowerCase()}
                </Badge>
                {s.fileName && <span className="text-muted-foreground">{s.fileName}</span>}
                {s.error && <span className="text-destructive">{s.error}</span>}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
