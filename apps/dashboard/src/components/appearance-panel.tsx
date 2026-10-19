"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useChatbot } from "@/lib/chatbot";
import { useSession } from "@/lib/session";
import {
  ACCENTS,
  DENSITIES,
  FONTS,
  RADII,
  TEXT_SIZES,
  isHexColor,
  useThemeSettings,
  type FontId,
} from "@/lib/theme-settings";
import { toastError, toastSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

function Choice({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center justify-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium transition-colors hover:bg-accent",
        selected && "border-primary bg-accent text-accent-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The company's own color: type or pick it, and the dashboard follows.
 * "Use for chatbot" copies the same color into the chatbot's draft so the
 * widget matches the site; it still needs a publish like any other edit.
 */
function ChatbotColorButton() {
  const { me } = useSession();
  const { brand } = useThemeSettings();
  const { chatbot, saveDraft } = useChatbot();
  const [saving, setSaving] = useState(false);
  if (me.role === "VIEWER" || !chatbot) return null;

  async function applyToChatbot() {
    if (!chatbot) return;
    setSaving(true);
    try {
      await saveDraft({
        ...chatbot.draftConfig,
        widget: { ...chatbot.draftConfig.widget, primaryColor: brand },
      });
      toastSuccess("Chatbot color saved as a draft. Publish to make it live.");
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={saving}
      onClick={applyToChatbot}
    >
      {saving ? "Saving…" : "Use this color for the chatbot too"}
    </Button>
  );
}

function CustomColor({ withChatbot }: { withChatbot: boolean }) {
  const { settings, setCustom } = useThemeSettings();
  const [text, setText] = useState(settings.custom);
  const valid = isHexColor(text);

  function commit(value: string) {
    setText(value);
    if (isHexColor(value)) setCustom(value.toLowerCase());
  }

  return (
    <Section
      title="Custom color"
      hint="Enter your website's brand color to make the dashboard match it."
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick a custom color"
          value={valid ? text.toLowerCase() : settings.custom}
          onChange={(e) => commit(e.target.value)}
          className="size-10 shrink-0 cursor-pointer rounded-lg border bg-card p-1"
        />
        <Input
          aria-label="Custom color hex code"
          aria-invalid={!valid}
          value={text}
          maxLength={7}
          placeholder="#059669"
          onChange={(e) => {
            const v = e.target.value.trim();
            commit(v.startsWith("#") || v === "" ? v : `#${v}`);
          }}
          className="font-mono uppercase"
        />
      </div>
      {!valid && (
        <p className="text-xs text-destructive">
          Use a 6-digit hex code like #059669.
        </p>
      )}
      {withChatbot && <ChatbotColorButton />}
    </Section>
  );
}

function FontSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border bg-card px-3 text-sm font-normal text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {children}
      </select>
    </label>
  );
}

/** Header button + slide-over panel for mode, accent color and shape. */
export function AppearancePanel({ withChatbot = false }: { withChatbot?: boolean }) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const {
    settings,
    setAccent,
    setRadius,
    setBodyFont,
    setHeadingFont,
    setTextSize,
    setDensity,
    reset,
  } = useThemeSettings();

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Appearance"
        onClick={() => setOpen(true)}
      >
        <Palette />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>Appearance</SheetTitle>
            <SheetDescription>
              Pick the look of your dashboard. It is saved in this browser.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-6 p-4 pt-0">
            <Section title="Theme mode" hint="Light, dark or your device setting.">
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <Choice
                    key={m.id}
                    selected={theme === m.id}
                    onClick={() => setTheme(m.id)}
                    className="h-16 flex-col gap-1"
                  >
                    <m.icon className="size-4" />
                    {m.label}
                  </Choice>
                ))}
              </div>
            </Section>

            <Section
              title="Accent color"
              hint="Used for buttons, links, focus rings and the sidebar."
            >
              <div className="grid grid-cols-2 gap-2">
                {ACCENTS.map((a) => (
                  <Choice
                    key={a.id}
                    selected={settings.accent === a.id}
                    onClick={() => setAccent(a.id)}
                    className="justify-start"
                  >
                    <span
                      className="grid size-4 place-items-center rounded-full"
                      style={{ background: a.hex }}
                    >
                      {settings.accent === a.id && (
                        <Check className="size-3 text-white" />
                      )}
                    </span>
                    {a.label}
                  </Choice>
                ))}
              </div>
            </Section>

            <CustomColor withChatbot={withChatbot} />

            <Section title="Corners" hint="How round cards and buttons are.">
              <div className="grid grid-cols-3 gap-2">
                {RADII.map((r) => (
                  <Choice
                    key={r.id}
                    selected={settings.radius === r.id}
                    onClick={() => setRadius(r.id)}
                  >
                    {r.label}
                  </Choice>
                ))}
              </div>
            </Section>

            <Section
              title="Fonts"
              hint="Pick one font for headings and one for paragraphs."
            >
              <FontSelect
                label="Headings"
                value={settings.headingFont ?? "same"}
                onChange={(v) =>
                  setHeadingFont(v === "same" ? null : (v as FontId))
                }
              >
                <option value="same">Same as paragraphs</option>
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </FontSelect>
              <FontSelect
                label="Paragraphs"
                value={settings.bodyFont}
                onChange={(v) => setBodyFont(v as FontId)}
              >
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </FontSelect>
            </Section>

            <Section title="Text size" hint="Scales text and spacing together.">
              <div className="grid grid-cols-3 gap-2">
                {TEXT_SIZES.map((t) => (
                  <Choice
                    key={t.id}
                    selected={settings.textSize === t.id}
                    onClick={() => setTextSize(t.id)}
                  >
                    {t.label}
                  </Choice>
                ))}
              </div>
            </Section>

            <Section title="Spacing" hint="How tightly things are packed.">
              <div className="grid grid-cols-3 gap-2">
                {DENSITIES.map((d) => (
                  <Choice
                    key={d.id}
                    selected={settings.density === d.id}
                    onClick={() => setDensity(d.id)}
                  >
                    {d.label}
                  </Choice>
                ))}
              </div>
            </Section>

            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              Reset to default
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
