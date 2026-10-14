"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Bot,
  Check,
  ChevronsUpDown,
  House,
  LogOut,
  MessageCircle,
  Package,
  Settings,
  Shield,
} from "lucide-react";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSession } from "@/lib/session";
import { toastError } from "@/lib/toast";

// D-3 §2. Chatbot, Knowledge, Products and Install arrive with M2–M4;
// only pages that exist are listed.
const NAV_ITEMS = [
  { title: "Home", href: "/app", icon: House },
  { title: "Chatbot", href: "/app/chatbot", icon: Bot },
  { title: "Knowledge", href: "/app/knowledge", icon: BookOpen },
  { title: "Products", href: "/app/products", icon: Package },
  { title: "Settings", href: "/app/settings", icon: Settings },
];

function initial(text: string): string {
  return text.trim().charAt(0).toUpperCase() || "?";
}

/** M1-27: the company dashboard sidebar with the workspace switcher. */
export function WorkspaceSidebar() {
  const pathname = usePathname();
  const { me, switchWorkspace, logout } = useSession();
  const workspace = me.activeWorkspace;

  async function handleSwitch(workspaceId: string) {
    if (workspaceId === workspace?.id) return;
    try {
      await switchWorkspace(workspaceId);
    } catch (err) {
      toastError((err as Error).message);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton size="lg">
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      {initial(workspace?.name ?? "")}
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">
                        {workspace?.name ?? "No workspace"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground capitalize">
                        {me.role?.toLowerCase() ?? ""}
                      </span>
                    </div>
                    {me.memberships.length > 1 && (
                      <ChevronsUpDown className="ml-auto size-4" />
                    )}
                  </SidebarMenuButton>
                }
              />
              {me.memberships.length > 1 && (
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                    {me.memberships.map((m) => (
                      <DropdownMenuItem
                        key={m.workspace.id}
                        onClick={() => handleSwitch(m.workspace.id)}
                      >
                        <span className="truncate">{m.workspace.name}</span>
                        {m.workspace.id === workspace?.id && (
                          <Check className="ml-auto" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              )}
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/app"
                    ? pathname === "/app"
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      render={
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className="h-12 w-full justify-start gap-2 px-2 text-left font-normal group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:px-0"
                  >
                    <Avatar className="size-7 shrink-0 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                        {initial(me.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                      <span className="truncate font-medium">
                        {me.user.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {me.user.email}
                      </span>
                    </span>
                    <ChevronsUpDown className="ml-auto size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
                  </Button>
                }
              />
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    render={
                      <Link href="/chat">
                        <MessageCircle />
                        Demo chat
                      </Link>
                    }
                  />
                  {me.user.isPlatformAdmin && (
                    <DropdownMenuItem
                      render={
                        <Link href="/admin">
                          <Shield />
                          Platform admin
                        </Link>
                      }
                    />
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={logout}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
