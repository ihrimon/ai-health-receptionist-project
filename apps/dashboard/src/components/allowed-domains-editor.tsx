"use client";

import { CircleAlert, Plus, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDomain } from "@/lib/allowed-domains";
import { useChatbot } from "@/lib/chatbot";

/**
 * The sites allowed to show the chat (FR-3.4, D-3 §3.5). Every add or
 * remove saves at once: it is a security setting, so it doesn't wait for
 * Publish (D-4 §2). Viewers see the list without the edit controls.
 */
export function AllowedDomainsEditor({ canEdit }: { canEdit: boolean }) {
  const { chatbot, setAllowedDomains } = useChatbot();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const domains = chatbot?.allowedDomains ?? [];

  async function save(next: string[]): Promise<boolean> {
    setBusy(true);
    try {
      await setAllowedDomains(next);
      setError(null);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const result = addDomain(domains, input);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (await save(result.domains)) setInput("");
  }

  return (
    <div className="grid gap-3">
      {domains.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Allowed domains">
          {domains.map((domain) => (
            <li
              key={domain}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-3 text-sm"
            >
              <span className="font-mono">{domain}</span>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={busy}
                  aria-label={`Remove ${domain}`}
                  onClick={() =>
                    void save(domains.filter((d) => d !== domain))
                  }
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          No domains yet. Add your website so the chat can load there; with
          an empty list it won&apos;t load on any site.
        </p>
      )}

      {canEdit && (
        <form onSubmit={(e) => void add(e)} className="grid gap-1.5">
          <label htmlFor={inputId} className="sr-only">
            Domain
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              placeholder="shop.example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              disabled={busy}
              className="max-w-xs"
            />
            <Button type="submit" variant="outline" disabled={busy}>
              <Plus />
              Add domain
            </Button>
          </div>
          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      )}

      <p className="text-xs text-muted-foreground">
        Only the domain, e.g. <code>shop.example.com</code>.{" "}
        <code>*.example.com</code> covers every subdomain but not{" "}
        <code>example.com</code> itself, so add both if you need both. For
        testing on your own computer, add <code>localhost:3000</code> (your
        port). Changes apply right away, without publishing.
      </p>
    </div>
  );
}
