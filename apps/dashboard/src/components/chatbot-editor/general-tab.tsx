"use client";

import type { ChatbotConfig } from "@brainstack/shared";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FieldErrors } from "@/lib/config-form";
import {
  CURRENCIES,
  firstSocial,
  SOCIAL,
  SOCIAL_KINDS,
  type SocialKind,
  withSaved,
} from "@/lib/select-options";
import { Section } from "./section";
import { Field, TextAreaField, TextField } from "./fields";

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
  // Every social contact keeps its own value; the select picks which one is edited.
  const [social, setSocial] = useState<SocialKind>(() => firstSocial(contact));
  const currencies = withSaved(CURRENCIES, business.currency);
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
          <Field label="Currency" error={errors["business.currency"]}>
            <Select
              items={currencies}
              value={business.currency}
              onValueChange={(v) =>
                edit((d) => void (d.business.currency = v as string))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
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
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-[12rem_1fr]">
            <Field label="Social Contact">
              <Select
                items={SOCIAL_KINDS.map((k) => ({ value: k, label: SOCIAL[k].label }))}
                value={social}
                onValueChange={(v) => setSocial(v as SocialKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOCIAL_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {SOCIAL[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <TextField
              key={social}
              label={SOCIAL[social].field}
              type={SOCIAL[social].type}
              placeholder={SOCIAL[social].placeholder}
              value={contact[social] ?? null}
              error={errors[`business.contact.${social}`]}
              onChange={(v) =>
                edit((d) => void (d.business.contact[social] = v))
              }
            />
          </div>
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
