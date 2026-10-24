"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, formatDateTime } from "@/lib/api";
import { EMAIL_FEATURES_ENABLED } from "@/lib/features";
import { TIME_ZONES, withSaved } from "@/lib/select-options";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  changedFields,
  formOf,
  PLAN_NAMES,
  passwordProblem,
  ROLE_LABELS,
  workspaceSettingsApi,
  type ProfileForm,
  type WorkspaceMember,
  type WorkspaceProfile,
} from "@/lib/workspace-settings";

// Same rule as the API (D-2 §2.1): at least 10 characters.
const PASSWORD_MIN_LENGTH = 10;

/**
 * Settings → Workspace (M1-27, M7-42): the company's profile (owners edit,
 * everyone can read), the people in the workspace (owners and admins), and
 * the signed-in person's own name and password.
 */
export default function WorkspaceSettingsPage() {
  const { me } = useSession();
  const isOwner = me.role === "OWNER";
  const canSeeTeam = me.role === "OWNER" || me.role === "ADMIN";

  return (
    <div className="grid gap-4">
      {me.activeWorkspace && (
        // Keyed so everything resets after switching workspace.
        <WorkspaceCard key={me.activeWorkspace.id} isOwner={isOwner} />
      )}
      {me.activeWorkspace && canSeeTeam && (
        <TeamCard key={`team-${me.activeWorkspace.id}`} />
      )}
      <AccountCard />
      <PasswordCard />
    </div>
  );
}

function WorkspaceCard({ isOwner }: { isOwner: boolean }) {
  const { refresh } = useSession();
  const [profile, setProfile] = useState<WorkspaceProfile | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    workspaceSettingsApi.profile().then(
      (loaded) => {
        if (cancelled) return;
        setProfile(loaded);
        setForm(formOf(loaded));
      },
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile || !form) return <Skeleton className="h-96 w-full" />;

  const changes = changedFields(profile, form);
  const set = (key: keyof ProfileForm) => (value: string) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!changes) return;
    setSaving(true);
    try {
      const saved = await workspaceSettingsApi.update(changes);
      setProfile(saved);
      setForm(formOf(saved));
      // The workspace name shows in the sidebar.
      await refresh();
      toastSuccess("Workspace saved.");
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          {isOwner
            ? "About your company. The name shows across the dashboard."
            : "Only the workspace owner can change this."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2 text-sm">
          <Row label="Address" value={profile.slug} />
          <Row label="Plan" value={PLAN_NAMES[profile.plan]} />
          <Row
            label="Status"
            value={profile.status === "ACTIVE" ? "Active" : "Suspended"}
          />
          <Row label="Created" value={formatDateTime(profile.createdAt)} />
        </div>

        <form onSubmit={handleSave} className="grid gap-4 sm:max-w-lg">
          <Field id="ws-name" label="Company name" required>
            <Input
              id="ws-name"
              required
              maxLength={100}
              disabled={!isOwner}
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
            />
          </Field>
          <Field id="ws-website" label="Website">
            <Input
              id="ws-website"
              type="url"
              inputMode="url"
              maxLength={200}
              placeholder="https://example.com"
              disabled={!isOwner}
              value={form.website}
              onChange={(e) => set("website")(e.target.value)}
            />
          </Field>
          <Field id="ws-industry" label="Industry">
            <Input
              id="ws-industry"
              maxLength={80}
              placeholder="e.g. HVAC, Retail, Clinic"
              disabled={!isOwner}
              value={form.industry}
              onChange={(e) => set("industry")(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ws-email" label="Contact email">
              <Input
                id="ws-email"
                type="email"
                maxLength={255}
                disabled={!isOwner}
                value={form.contactEmail}
                onChange={(e) => set("contactEmail")(e.target.value)}
              />
            </Field>
            <Field id="ws-phone" label="Contact phone">
              <Input
                id="ws-phone"
                type="tel"
                maxLength={30}
                disabled={!isOwner}
                value={form.contactPhone}
                onChange={(e) => set("contactPhone")(e.target.value)}
              />
            </Field>
          </div>
          <Field id="ws-timezone" label="Time zone">
            <Select
              items={withSaved(TIME_ZONES, form.timeZone)}
              value={form.timeZone}
              disabled={!isOwner}
              onValueChange={(v) => set("timeZone")(v as string)}
            >
              <SelectTrigger id="ws-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withSaved(TIME_ZONES, form.timeZone).map((z) => (
                  <SelectItem key={z.value} value={z.value}>
                    <span>{z.label}</span>
                    <span className="text-muted-foreground">{z.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {isOwner && (
            <Button type="submit" disabled={saving || !changes} className="w-fit">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function TeamCard() {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    workspaceSettingsApi.members().then(
      (rows) => !cancelled && setMembers(rows),
      (err: Error) => !cancelled && toastError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          People who can use this workspace. Inviting more people will come
          later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {members === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.email}>
                    <TableCell>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.role === "OWNER" ? "default" : "secondary"}>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(m.joinedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me.user.name);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await workspaceSettingsApi.updateName(name.trim());
      await refresh();
      toastSuccess("Name saved.");
    } catch (err) {
      toastError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account</CardTitle>
        <CardDescription>
          Only you see and change this. It is the same in every workspace you
          belong to.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 text-sm">
          <Row label="Email" value={me.user.email} />
          <Row label="Your role here" value={me.role ? ROLE_LABELS[me.role] : "—"} />
          {EMAIL_FEATURES_ENABLED && (
            <Row
              label="Email verified"
              value={me.user.emailVerifiedAt ? "Yes" : "Not yet"}
            />
          )}
        </div>
        <form onSubmit={handleSave} className="grid gap-4 sm:max-w-sm">
          <Field id="account-name" label="Your name" required>
            <Input
              id="account-name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            disabled={saving || !name.trim() || name.trim() === me.user.name}
            className="w-fit"
          >
            {saving ? "Saving…" : "Save name"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);
  const problem = passwordProblem(current, next, again, PASSWORD_MIN_LENGTH);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    try {
      await workspaceSettingsApi.changePassword(current, next);
      setCurrent("");
      setNext("");
      setAgain("");
      toastSuccess("Password changed. Other devices are signed out.");
    } catch (err) {
      toastError(
        err instanceof ApiError && err.status === 429
          ? "Too many tries. Please wait a few minutes."
          : (err as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          After a change, you stay signed in here and every other device is
          signed out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="grid gap-4 sm:max-w-sm">
          <Field id="pw-current" label="Current password">
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field id="pw-new" label="New password">
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least {PASSWORD_MIN_LENGTH} characters.
            </p>
          </Field>
          <Field id="pw-again" label="New password again">
            <Input
              id="pw-again"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </Field>
          {problem && (current || next || again) && (
            <p className="text-xs text-muted-foreground">{problem}</p>
          )}
          <Button type="submit" disabled={saving || problem !== null} className="w-fit">
            {saving ? "Saving…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}
