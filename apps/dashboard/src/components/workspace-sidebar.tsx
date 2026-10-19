"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronRight, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { NAV_GROUPS, isActivePath, isParent, type NavParent } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

function initial(text: string): string {
  return text.trim().charAt(0).toUpperCase() || "?";
}

/** A menu entry with sub-pages. Collapsed to icons, it opens the first page. */
function ParentItem({ item }: { item: NavParent }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile } = useSidebar();
  const childActive = item.children.some((c) => isActivePath(pathname, c.href));
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? childActive;
  const iconOnly = state === "collapsed" && !isMobile;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={childActive}
        tooltip={item.title}
        aria-expanded={open}
        onClick={() => {
          if (iconOnly) router.push(item.children[0].href);
          else setToggled(!open);
        }}
      >
        <item.icon />
        <span>{item.title}</span>
        <ChevronRight
          className={cn("ml-auto transition-transform", open && "rotate-90")}
        />
      </SidebarMenuButton>
      {open && !iconOnly && (
        <SidebarMenuSub>
          {item.children.map((child) => (
            <SidebarMenuSubItem key={child.href}>
              <SidebarMenuSubButton
                isActive={isActivePath(pathname, child.href)}
                render={<Link href={child.href}>{child.title}</Link>}
              />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

/** M1-27: the company dashboard sidebar with the workspace switcher. */
export function WorkspaceSidebar() {
  const pathname = usePathname();
  const { me, switchWorkspace } = useSession();
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
      <SidebarHeader className="h-16 justify-center border-b">
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
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[11px] font-semibold tracking-wider uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) =>
                  isParent(item) ? (
                    <ParentItem key={item.title} item={item} />
                  ) : (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActivePath(pathname, item.href)}
                        tooltip={item.title}
                        render={
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
