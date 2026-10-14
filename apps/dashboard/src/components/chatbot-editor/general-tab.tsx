"use client";

import type { ChatbotConfig } from "@brainstack/shared";
import type { FieldErrors } from "@/lib/config-form";
import { Section } from "./section";
import { TextAreaField, TextField } from "./fields";

export interface TabProps {
  draft: ChatbotConfig;
  /** Changes a copy of the draft; the editor keeps it as the new draft. */
  edit: (change: (draft: ChatbotConfig) => void) => void;
  errors: FieldErrors;
}

/** General tab (D-3 §3.2): the bot's identity and the business behind it. */
export function GeneralTab({ draft, edit, errors }: TabProps) {
  const { identity, business } = draft;
  const contact = business.contact;
  return (
    <>
      <Section title="Bot">
        <TextField
          label="Bot name"
          value={identity.botName}
          max={40}
          error={errors["identity.botName"]}
          onChange={(v) => edit((d) => void (d.identity.botName = v))}
        />
        <TextAreaField
          label="Welcome message"
          hint="The first message visitors see when they open the chat."
          value={identity.welcomeMessage}
          max={300}
          rows={2}
          error={errors["identity.welcomeMessage"]}
          onChange={(v) => edit((d) => void (d.identity.welcomeMessage = v))}
        />
        <p className="text-xs text-muted-foreground">
          Uploading an avatar comes with image uploads later.
        </p>
      </Section>

      <Section
        title="Business"
        description="The bot uses this to introduce your business and answer general questions."
      >
        <TextField
          label="Business name"
          value={business.name}
          max={80}
          error={errors["business.name"]}
          onChange={(v) => edit((d) => void (d.business.name = v))}
        />
        <TextAreaField
          label="Description"
          hint="What you sell or do, in 2–5 sentences. Needed before you can publish."
          placeholder="We sell handmade leather shoes and bags…"
          value={business.description}
          max={1000}
          rows={4}
          error={errors["business.description"]}
          onChange={(v) => edit((d) => void (d.business.description = v))}
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <TextField
            label="Website"
            type="url"
            placeholder="https://shop.example.com"
            value={business.websiteUrl}
            error={errors["business.websiteUrl"]}
            onChange={(v) => edit((d) => void (d.business.websiteUrl = v))}
          />
          <TextField
            label="Currency"
            hint="e.g. BDT, USD"
            value={business.currency}
            error={errors["business.currency"]}
            onChange={(v) =>
              edit((d) => void (d.business.currency = v.toUpperCase()))
            }
          />
        </div>
      </Section>

      <Section
        title="Contact"
        description="Shared with visitors who ask how to reach you. Leave blank what you don't use."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            value={contact.email}
            error={errors["business.contact.email"]}
            onChange={(v) => edit((d) => void (d.business.contact.email = v))}
          />
          <TextField
            label="Phone"
            type="tel"
            value={contact.phone}
            error={errors["business.contact.phone"]}
            onChange={(v) => edit((d) => void (d.business.contact.phone = v))}
          />
          <TextField
            label="WhatsApp"
            type="tel"
            value={contact.whatsapp}
            error={errors["business.contact.whatsapp"]}
            onChange={(v) =>
              edit((d) => void (d.business.contact.whatsapp = v))
            }
          />
          <TextField
            label="Opening hours"
            placeholder="Sat–Thu 10am–8pm"
            value={contact.hours}
            error={errors["business.contact.hours"]}
            onChange={(v) => edit((d) => void (d.business.contact.hours = v))}
          />
        </div>
        <TextAreaField
          label="Address"
          value={contact.address}
          rows={2}
          error={errors["business.contact.address"]}
          onChange={(v) => edit((d) => void (d.business.contact.address = v))}
        />
      </Section>
    </>
  );
}
