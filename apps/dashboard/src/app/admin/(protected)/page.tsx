"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Headset, MessagesSquare, Star } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, formatDateTime, type Conversation } from "@/lib/api";

// Interim overview for the platform branch (M1). The workspace dashboard
// home with the onboarding checklist replaces it (docs/design/d3-screens.md §3.1).
export default function AdminOverviewPage() {
  const [conversations, setConversations] = useState<Conversation[] | null>(
    null,
  );

  useEffect(() => {
    apiFetch<Conversation[]>("/conversations")
      .then(setConversations)
      .catch(() => setConversations([]));
  }, []);

  const rated = useMemo(
    () => conversations?.filter((c) => c.rating != null) ?? [],
    [conversations],
  );
  const averageRating = rated.length
    ? (rated.reduce((sum, c) => sum + (c.rating ?? 0), 0) / rated.length).toFixed(1)
    : undefined;

  const stats = [
    {
      title: "Conversations",
      value: conversations?.length,
      description: "chat sessions",
      icon: MessagesSquare,
      href: "/admin/conversations",
    },
    {
      title: "Average rating",
      value: averageRating,
      description: `${rated.length} rated`,
      icon: Star,
      href: "/admin/conversations",
    },
  ];

  const recentConversations = conversations?.slice(0, 5) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Headset className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">BrainStack AI Receptionist</h1>
          <p className="text-sm text-muted-foreground">
            AI chat assistant — admin overview
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.title} href={s.href}>
            <Card className="transition-colors hover:border-primary/40">
              <CardHeader>
                <CardDescription>{s.title}</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums">
                  {s.value ?? "—"}
                </CardTitle>
                <CardAction>
                  <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <s.icon className="size-4.5" />
                  </div>
                </CardAction>
              </CardHeader>
              {s.description && (
                <CardFooter className="text-xs text-muted-foreground">
                  {s.description}
                </CardFooter>
              )}
            </Card>
          </Link>
        ))}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle>Recent conversations</CardTitle>
          <CardDescription>The latest chat sessions</CardDescription>
          <CardAction>
            <Link
              href="/admin/conversations"
              className="text-sm text-primary hover:underline"
            >
              View all
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-auto">
          {!conversations ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : recentConversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No conversations yet — try the{" "}
              <Link href="/chat" className="underline">
                chat page
              </Link>
              .
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentConversations.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={`/admin/conversations/${c.id}`}
                        className="font-medium hover:underline"
                      >
                        {formatDateTime(c.createdAt)}
                      </Link>
                    </TableCell>
                    <TableCell>{c.transcript?.length ?? 0}</TableCell>
                    <TableCell>{c.rating ? `${c.rating} ★` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
