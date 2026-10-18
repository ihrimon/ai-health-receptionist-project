"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/session";

/**
 * A workspace the platform team suspended (M7-0): its members get this
 * page instead of a dashboard full of errors. The API refuses their
 * requests with 403 WORKSPACE_SUSPENDED either way; they can still switch
 * to another workspace or sign out.
 */
export function WorkspaceSuspendedGate({ children }: { children: React.ReactNode }) {
  const { me, switchWorkspace, logout } = useSession();
  const active = me.activeWorkspace;
  if (!active || active.status !== "SUSPENDED") return <>{children}</>;

  const others = me.memberships.filter((m) => m.workspace.id !== active.id);
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>This workspace is suspended</CardTitle>
          <CardDescription>
            {active.name} has been suspended by the BrainStack team, so the
            dashboard and the chat widget are switched off. Contact BrainStack
            support to get it back.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {others.map((m) => (
            <Button
              key={m.workspace.id}
              variant="outline"
              onClick={() => switchWorkspace(m.workspace.id)}
            >
              Switch to {m.workspace.name}
            </Button>
          ))}
          <Button variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
