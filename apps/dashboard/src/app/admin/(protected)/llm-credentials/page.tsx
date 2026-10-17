"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  apiFetch,
  formatDateTime,
  type LlmCredential,
  type LlmProvider,
} from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/toast";

// Groq and Gemini both offer a genuinely free, ongoing API tier (rate
// limited, but no card required). OpenRouter and UnoRouter are
// OpenAI-compatible aggregators whose ":free"-suffixed models are also
// free, no card required (OpenRouter: 20 req/min, 50/day without any
// credit purchase; UnoRouter: ~1 req/min per model, tighter — better as
// a last-resort fallback in the rotation order than a primary key).
// OpenAI and Anthropic don't have a standing free tier for API access —
// labeled here so picking a provider doesn't come as a billing surprise
// later.
const PROVIDERS: { value: LlmProvider; label: string; free: boolean }[] = [
  { value: "groq", label: "Groq", free: true },
  { value: "gemini", label: "Google (Gemini)", free: true },
  { value: "openrouter", label: "OpenRouter", free: true },
  { value: "unorouter", label: "UnoRouter", free: true },
  { value: "openai", label: "OpenAI", free: false },
  { value: "anthropic", label: "Anthropic (Claude)", free: false },
];

// A starting point, not an exhaustive/live list — providers ship new
// models faster than this can be kept in sync. "Custom…" always escapes
// to a free-text field for anything not listed here.
const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  groq: [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "gemma2-9b-it",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  anthropic: [
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-haiku-4-5-20251001",
    "claude-fable-5-1",
  ],
  gemini: ["gemini-3.6-flash", "gemini-3.6-pro", "gemini-flash-latest"],
  // Free-model catalogs change often on both aggregators — "Custom…" is
  // the reliable way to use whatever's currently free on their site;
  // these are just a starting point confirmed live at the time this was
  // written. The Settings page verifies the exact id against the real
  // provider on save, so a stale/renamed one here just needs picking
  // "Custom…" with the current id from openrouter.ai/models or
  // unorouter.com/en/models instead of silently breaking chat later.
  openrouter: [
    "inclusionai/ling-3.0-flash-vl:free",
    "nex-agi/nex-n2.5-mini:free",
    "nex-agi/nex-n2.5-pro:free",
  ],
  unorouter: [
    "zglm-5.3-flash:free",
    "zglm-5.3:free",
    "nex-n2.5-mini:free",
    "nex-n2.5-pro:free",
  ],
};
const CUSTOM_MODEL = "__custom__";

export default function LlmCredentialsPage() {
  return <LlmCredentialsSettings />;
}

/**
 * A snapshot of the provider's own rate-limit headers from the last time
 * this credential was actually used to answer a chat — not a live/polled
 * value (that would burn quota just to check). Shown so an admin can tell
 * how close a key is to its limit without leaving the dashboard.
 */
const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Parses a Go-duration-style string ("1m26.442s", "19.717s", "2h3m",
 * "500ms") — the shape these providers' x-ratelimit-reset-* headers use
 * — into milliseconds. Returns null for anything unrecognized rather
 * than guessing, so the caller can fall back to just not showing a
 * countdown instead of showing a wrong one.
 */
function parseDurationToMs(duration: string): number | null {
  const match = duration
    .trim()
    .match(
      /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/,
    );
  if (!match || match[0] === "") return null;
  const [, h, m, s, ms] = match;
  if (!h && !m && !s && !ms) return null;
  return (
    (Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000 +
    Number(ms ?? 0)
  );
}

/** milliseconds -> "1m26s" / "20s", the same compact style the raw header text used. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}

function UsageStat({
  remaining,
  limit,
  reset,
  lastUsedAt,
  now,
  unit,
  low,
}: {
  remaining: number;
  limit: number;
  reset?: string;
  lastUsedAt: string;
  now: number;
  unit: string;
  low: boolean;
}) {
  // A genuinely live countdown, not just the frozen header text: the
  // provider's "resets in Xs" is only true as of lastUsedAt (the moment
  // that response arrived), so it derives an absolute target time from
  // lastUsedAt + the parsed duration and counts down from `now` (ticking
  // every second, see the parent's setInterval) instead of quietly going
  // stale the moment this credential stops being the one in rotation.
  const durationMs = reset ? parseDurationToMs(reset) : null;
  const remainingMs =
    durationMs !== null
      ? new Date(lastUsedAt).getTime() + durationMs - now
      : null;

  return (
    <span className={low ? "text-amber-600 dark:text-amber-400" : undefined}>
      {compactNumber.format(remaining)}/{compactNumber.format(limit)} {unit}
      {remainingMs !== null && (
        <span className="text-muted-foreground/70">
          {" "}
          —{" "}
          {remainingMs > 0
            ? `resets in ${formatCountdown(remainingMs)}`
            : "may have reset by now"}
        </span>
      )}
    </span>
  );
}

function UsageLine({
  credential: c,
  now,
}: {
  credential: LlmCredential;
  now: number;
}) {
  if (!c.lastUsedAt) {
    return (
      <p className="mt-1 text-xs text-muted-foreground/70">Not used yet</p>
    );
  }

  const hasRequests =
    c.rlRemainingRequests !== undefined && c.rlLimitRequests !== undefined;
  const hasTokens =
    c.rlRemainingTokens !== undefined && c.rlLimitTokens !== undefined;

  if (!hasRequests && !hasTokens) {
    return (
      <p className="mt-1 text-xs text-muted-foreground/70">
        Last used {formatDateTime(c.lastUsedAt)}
      </p>
    );
  }

  return (
    <div className="mt-1 flex flex-col text-xs">
      {hasRequests && (
        <UsageStat
          remaining={c.rlRemainingRequests!}
          limit={c.rlLimitRequests!}
          reset={c.rlResetRequests}
          lastUsedAt={c.lastUsedAt}
          now={now}
          unit="requests"
          low={c.rlRemainingRequests! / c.rlLimitRequests! < 0.1}
        />
      )}
      {hasTokens && (
        <UsageStat
          remaining={c.rlRemainingTokens!}
          limit={c.rlLimitTokens!}
          reset={c.rlResetTokens}
          lastUsedAt={c.lastUsedAt}
          now={now}
          unit="token"
          low={c.rlRemainingTokens! / c.rlLimitTokens! < 0.1}
        />
      )}
    </div>
  );
}

function LlmCredentialsSettings() {
  const [credentials, setCredentials] = useState<LlmCredential[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LlmCredential | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [createOpen, setCreateOpen] = useState(false);
  const [provider, setProvider] = useState<LlmProvider>("groq");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(MODELS_BY_PROVIDER.groq[0]);
  const [customModel, setCustomModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<LlmCredential | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editCustomModel, setEditCustomModel] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function selectProvider(next: LlmProvider) {
    setProvider(next);
    setModel(MODELS_BY_PROVIDER[next][0]);
    setCustomModel("");
  }

  function openEdit(c: LlmCredential) {
    const isKnownModel = MODELS_BY_PROVIDER[c.provider].includes(c.model);
    setEditTarget(c);
    setEditApiKey("");
    setEditModel(isKnownModel ? c.model : CUSTOM_MODEL);
    setEditCustomModel(isKnownModel ? "" : c.model);
    setEditError(null);
  }

  function load() {
    apiFetch<LlmCredential[]>("/admin/llm-credentials")
      .then(setCredentials)
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  // Usage numbers (remaining requests/tokens) change the moment the chat
  // assistant actually uses a key, not on any schedule of ours — poll
  // periodically so an admin watching this page sees it move without
  // having to manually reload.
  useEffect(() => {
    const interval = setInterval(() => {
      load();
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Drives the live "resets in Xs" countdowns (see UsageStat) — a plain
  // client-side clock, no network call, so a 1s tick is cheap.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const resolvedModel = model === CUSTOM_MODEL ? customModel.trim() : model;
    if (!resolvedModel) return;

    setSaving(true);
    setCreateError(null);
    try {
      await apiFetch("/admin/llm-credentials", {
        method: "POST",
        body: JSON.stringify({ provider, apiKey, model: resolvedModel }),
      });
      toastSuccess(
        `${PROVIDERS.find((p) => p.value === provider)?.label ?? provider} key added.`,
      );
      setApiKey("");
      selectProvider("groq");
      setCreateOpen(false);
      load();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    const resolvedModel =
      editModel === CUSTOM_MODEL ? editCustomModel.trim() : editModel;
    if (!resolvedModel) return;

    setEditSaving(true);
    setEditError(null);
    try {
      await apiFetch(`/admin/llm-credentials/${editTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          model: resolvedModel,
          ...(editApiKey ? { apiKey: editApiKey } : {}),
        }),
      });
      toastSuccess("API key updated.");
      setEditTarget(null);
      load();
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(c: LlmCredential) {
    setBusyId(c.id);
    try {
      await apiFetch(`/admin/llm-credentials/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !c.isActive }),
      });
      toastSuccess(`Key is now ${c.isActive ? "paused" : "active"}.`);
      load();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!credentials) return;
    const target = index + direction;
    if (target < 0 || target >= credentials.length) return;
    const orderedIds = credentials.map((c) => c.id);
    [orderedIds[index], orderedIds[target]] = [
      orderedIds[target],
      orderedIds[index],
    ];
    setBusyId(credentials[index].id);
    try {
      await apiFetch("/admin/llm-credentials/reorder", {
        method: "PATCH",
        body: JSON.stringify({ orderedIds }),
      });
      // No success toast here on purpose — the row visibly moving up/down
      // is already the feedback, and every click would otherwise pop one.
      load();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await apiFetch(`/admin/llm-credentials/${deleteTarget.id}`, {
        method: "DELETE",
      });
      toastSuccess("API key deleted.");
      setDeleteTarget(null);
      load();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto grid max-w-5xl gap-6">
        <Card>
          <CardHeader>
            <CardTitle>LLM API keys</CardTitle>
            <CardDescription>
              The chat assistant uses the first key below to answer.
              If it hits its provider&apos;s rate limit, it automatically
              falls back to the next one — no code or redeploy needed to
              add, remove, or reorder keys, and you&apos;re not tied to any
              one provider.
            </CardDescription>
            <CardAction className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh usage"
                onClick={() => {
                  load();
                }}
              >
                <RefreshCw />
              </Button>
              <Dialog
                open={createOpen}
                onOpenChange={(open) => {
                  setCreateOpen(open);
                  if (open) setCreateError(null);
                }}
              >
                <DialogTrigger
                  render={
                    <Button>
                      <Plus /> Add key
                    </Button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add API key</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="grid gap-3">
                    <div className="grid gap-1.5">
                      <Label>Provider</Label>
                      <Select
                        value={provider}
                        onValueChange={(v) => selectProvider(v as LlmProvider)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDERS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                              <span
                                className={
                                  p.free
                                    ? "text-xs text-green-600 dark:text-green-400"
                                    : "text-xs text-muted-foreground"
                                }
                              >
                                {p.free ? "Free" : "Paid"}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!PROVIDERS.find((p) => p.value === provider)?.free && (
                        <p className="text-xs text-muted-foreground">
                          This provider has no ongoing free API tier — a
                          billing-enabled key is required. Groq and Gemini
                          are free.
                        </p>
                      )}
                    </div>
                    <div className="grid gap-1.5">
                      <Label>API key</Label>
                      <Input
                        type="password"
                        required
                        autoComplete="off"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="gsk_… / sk_… / etc."
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Model</Label>
                      <Select
                        value={model}
                        onValueChange={(v) => setModel(v ?? CUSTOM_MODEL)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODELS_BY_PROVIDER[provider].map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_MODEL}>Custom…</SelectItem>
                        </SelectContent>
                      </Select>
                      {model === CUSTOM_MODEL && (
                        <Input
                          required
                          autoFocus
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          placeholder="Exact model id"
                          className="mt-1.5"
                        />
                      )}
                    </div>
                    {createError && (
                      <p className="text-sm text-destructive">{createError}</p>
                    )}
                    <DialogFooter>
                      <Button type="submit" disabled={saving}>
                        {saving ? "Verifying…" : "Add key"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardAction>
          </CardHeader>
          <CardContent>
            {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
            {!error && !credentials && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {credentials && credentials.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No API keys yet — add one so the chat assistant can answer.
              </p>
            )}

            <div className="grid gap-2">
              {credentials?.map((c, index) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3"
                >
                  <div className="flex shrink-0 flex-col">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move up"
                      disabled={index === 0 || busyId === c.id}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move down"
                      disabled={index === credentials.length - 1 || busyId === c.id}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {index === 0 && <Badge>Default</Badge>}
                      <span className="text-sm font-medium">{c.model}</span>
                      <span className="text-xs text-muted-foreground">
                        {PROVIDERS.find((p) => p.value === c.provider)
                          ?.label ?? c.provider}
                      </span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <span className="truncate">{c.maskedKey}</span>
                    </div>
                    <UsageLine credential={c} now={now} />
                  </div>

                  <button type="button" onClick={() => toggleActive(c)}>
                    <Badge
                      variant="outline"
                      className={
                        c.isActive
                          ? "border-transparent bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : ""
                      }
                    >
                      {c.isActive ? "Active" : "Paused"}
                    </Badge>
                  </button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit key"
                    disabled={busyId === c.id}
                    onClick={() => openEdit(c)}
                  >
                    <Pencil />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete key"
                    disabled={busyId === c.id}
                    onClick={() => setDeleteTarget(c)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit API key</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <form onSubmit={handleSaveEdit} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Provider</Label>
                <p className="text-sm text-muted-foreground">
                  {PROVIDERS.find((p) => p.value === editTarget.provider)
                    ?.label ?? editTarget.provider}{" "}
                  — to switch providers, delete this key and add a new one.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label>API key (optional)</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={editApiKey}
                  onChange={(e) => setEditApiKey(e.target.value)}
                  placeholder="Leave blank to keep the current key"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Model</Label>
                <Select
                  value={editModel}
                  onValueChange={(v) => setEditModel(v ?? CUSTOM_MODEL)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODELS_BY_PROVIDER[editTarget.provider].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_MODEL}>Custom…</SelectItem>
                  </SelectContent>
                </Select>
                {editModel === CUSTOM_MODEL && (
                  <Input
                    required
                    autoFocus
                    value={editCustomModel}
                    onChange={(e) => setEditCustomModel(e.target.value)}
                    placeholder="Exact model id"
                    className="mt-1.5"
                  />
                )}
              </div>
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={editSaving}>
                  {editSaving ? "Verifying…" : "Save changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API key</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete the key for{" "}
            <span className="font-medium text-foreground">
              {deleteTarget?.model}
            </span>
            ? The chat assistant will stop using it immediately.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busyId === deleteTarget?.id}
              onClick={confirmDelete}
            >
              {busyId === deleteTarget?.id ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
