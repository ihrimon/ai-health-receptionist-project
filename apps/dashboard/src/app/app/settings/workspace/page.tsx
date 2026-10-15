"use client";

import { useState, type FormEvent } from "react";
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
import { apiFetch, type Me } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * M1-27 settings: the workspace name (owners only; the API checks too) and
 * the account details. Changing your own name/password and deleting the
 * workspace need D-2 §2.7 endpoints that don't exist yet.
 */
export default function WorkspaceSettingsPage() {
  const { me } = useSession();

  return (
    <div className="grid gap-4">
      {me.activeWorkspace && (
        // Keyed so the form resets after switching workspace.
        <WorkspaceCard
          key={me.activeWorkspace.id}
          workspace={me.activeWorkspace}
          isOwner={me.role === "OWNER"}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row label="Name" value={me.user.name} />
          <Row label="Email" value={me.user.email} />
          <Row
            label="Email verified"
            value={me.user.emailVerifiedAt ? "Yes" : "Not yet"}
          />
          <Row label="Role" value={me.role ? me.role.toLowerCase() : "—"} />
        </CardContent>
      </Card>
    </div>
  );
}

function WorkspaceCard({
  workspace,
  isOwner,
}: {
  workspace: NonNullable<Me["activeWorkspace"]>;
  isOwner: boolean;
}) {
  const { refresh } = useSession();
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/workspace", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await refresh();
      toastSuccess("Workspace renamed.");
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
            ? "Your company's name, shown across the dashboard."
            : "Only the workspace owner can change this."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleRename} className="grid gap-4 sm:max-w-sm">
          <div className="grid gap-1.5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              required
              maxLength={100}
              disabled={!isOwner}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {isOwner && (
            <Button
              type="submit"
              disabled={saving || name.trim() === workspace.name}
              className="w-fit"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
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
