"use client";

import Link from "next/link";
import { LogOut, Shield } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/lib/session";

/** The signed-in person, top right (moved here from the sidebar footer). */
export function UserMenu() {
  const { me, logout } = useSession();
  const { user, role } = me;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-10 gap-2 px-1.5 sm:px-2">
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {user.name.trim().charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-left leading-tight md:grid">
              <span className="max-w-32 truncate text-sm font-medium">
                {user.name}
              </span>
              <span className="text-xs font-normal text-muted-foreground capitalize">
                {role?.toLowerCase() ?? "Member"}
              </span>
            </span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">
              {user.name}
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {user.email}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {user.isPlatformAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <Link href="/admin">
                  <Shield />
                  Platform admin
                </Link>
              }
            />
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={logout}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
