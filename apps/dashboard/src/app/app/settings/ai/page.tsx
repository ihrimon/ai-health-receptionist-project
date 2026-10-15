"use client";

import {
  LLM_KEY_LIMITS,
  LLM_KEY_PROVIDERS,
  type LlmKeyProvider,
} from "@brainstack/shared";
import { KeyRound, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { Field } from "@/components/chatbot-editor/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  canChat,
  type LlmKey,
  llmKeysApi,
  maskedKey,
  PROVIDER_KEY_PAGES,
  PROVIDER_LABELS,
  SUGGESTED_MODELS,
} from "@/lib/llm-keys";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

const PROVIDER_ITEMS = LLM_KEY_PROVIDERS.map((value) => ({
  value,
  label: PROVIDER_LABELS[value],
}));

/**
 * Settings → AI (M3-21): the workspace's own LLM API keys. Chat runs on
 * them and is off without one. Owner only, like the API.
 */
export default function AiSettingsPage() {
  const { me } = useSession();

  if (me.role !== "OWNER") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI model</CardTitle>
          <CardDescription>
            Only the workspace owner can add or change the AI API keys.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  // Keyed so the list reloads after switching workspace.
  return <KeysManager key={me.activeWorkspace?.id} />;
}

function KeysManager() {
  const [keys, setKeys] = useState<LlmKey[] | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await llmKeysApi.list());
    } catch (err) {
      toastError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    llmKeysApi.list().then(
      (list) => !cancelled && setKeys(list),
      (err: Error) => toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!keys) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your AI keys</CardTitle>
          <CardDescription>
            Your chatbot answers with your own AI provider account, so usage
            is billed to you by the provider. Keys are stored encrypted and
            never shown again after saving. With several keys, the oldest
            one is tried first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!canChat(keys) && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
              Chat is off until you add a key and switch it on.
            </p>
          )}
          {keys.map((k) => (
            <KeyRow key={k.id} item={k} onChanged={load} />
          ))}
        </CardContent>
      </Card>

      {keys.length < LLM_KEY_LIMITS.maxKeys ? (
        <AddKeyCard onAdded={load} />
      ) : (
        <p className="text-sm text-muted-foreground">
          You have {LLM_KEY_LIMITS.maxKeys} keys, the most a workspace can
          have. Delete one to add another.
        </p>
      )}
    </div>
  );
}

function KeyRow({
  item,
  onChanged,
}: {
  item: LlmKey;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toastSuccess(done);
      await onChanged();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
      <KeyRound className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{PROVIDER_LABELS[item.provider]}</span>
          <Badge variant="outline" className="font-mono">
            {maskedKey(item)}
          </Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {item.model} ·{" "}
          {item.lastUsedAt
            ? `last used ${new Date(item.lastUsedAt).toLocaleString()}`
            : "not used yet"}
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <Switch
          checked={item.isActive}
          disabled={busy}
          onCheckedChange={(on) =>
            void run(
              () => llmKeysApi.update(item.id, { isActive: on }),
              on ? "Key switched on." : "Key switched off.",
            )
          }
        />
        {item.isActive ? "On" : "Off"}
      </label>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete this key"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Delete this API key? It can't be undone.")) {
            void run(() => llmKeysApi.remove(item.id), "Key deleted.");
          }
        }}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function AddKeyCard({ onAdded }: { onAdded: () => Promise<void> }) {
  const [provider, setProvider] = useState<LlmKeyProvider>("openai");
  const [model, setModel] = useState(SUGGESTED_MODELS.openai[0]);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const modelsId = useId();
  const keyId = useId();
  const modelId = useId();

  function chooseProvider(next: LlmKeyProvider) {
    setProvider(next);
    setModel(SUGGESTED_MODELS[next][0]);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await llmKeysApi.create({
        provider,
        model: model.trim(),
        apiKey: apiKey.trim(),
      });
      setApiKey("");
      toastSuccess("Key checked and saved. Your chatbot can answer now.");
      await onAdded();
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a key</CardTitle>
        <CardDescription>
          We send one tiny test message to check the key and model before
          saving.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4 sm:max-w-md">
          <Field label="Provider">
            <Select
              items={PROVIDER_ITEMS}
              value={provider}
              onValueChange={(v) => chooseProvider(v as LlmKeyProvider)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Model"
            htmlFor={modelId}
            hint="Pick a suggestion or type any model your account can use."
          >
            <Input
              id={modelId}
              required
              maxLength={100}
              list={modelsId}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id={modelsId}>
              {SUGGESTED_MODELS[provider].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="API key" htmlFor={keyId}>
            <Input
              id={keyId}
              type="password"
              required
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <a
              href={PROVIDER_KEY_PAGES[provider]}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Get a {PROVIDER_LABELS[provider]} key
            </a>
          </Field>
          <Button
            type="submit"
            className="w-fit"
            disabled={saving || !apiKey.trim() || !model.trim()}
          >
            {saving ? "Checking…" : "Check and save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
