import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { type IngestStatus, statusBadge } from "@/lib/knowledge";

const TONE_CLASS = {
  neutral: "",
  busy: "",
  ok: "border-emerald-600/30 text-emerald-700 dark:text-emerald-400",
  error: "",
} as const;

/** Queued · Processing… · Ready ✓ · Failed ⚠ (D-3 §3.3). */
export function StatusBadge({ status }: { status: IngestStatus }) {
  const { label, tone } = statusBadge(status);
  return (
    <Badge
      variant={tone === "error" ? "destructive" : "outline"}
      className={cn(TONE_CLASS[tone])}
    >
      {tone === "busy" && <Loader2 className="animate-spin" />}
      {tone === "ok" && <CircleCheck />}
      {tone === "error" && <CircleAlert />}
      {label}
    </Badge>
  );
}
