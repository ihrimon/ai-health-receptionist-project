"use client";

import Link from "next/link";
import {
  Bot,
  Building2,
  Code2,
  FileText,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Shield,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
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

interface MenuLink {
  title: string;
  href: string;
  icon: LucideIcon;
}

/** Shortcuts to the pages people look for most; same routes as the sidebar. */
const WORKSPACE_LINKS: MenuLink[] = [
  { title: "Overview", href: "/app", icon: LayoutDashboard },
  { title: "Account & workspace", href: "/app/settings/workspace", icon: Building2 },
  { title: "Chatbot settings", href: "/app/settings/chatbot", icon: Bot },
  { title: "API key", href: "/app/settings/ai", icon: KeyRound },
  { title: "Install chatbot", href: "/app/settings/install", icon: Code2 },
];

const HELP_LINKS: MenuLink[] = [
  { title: "Help center", href: "/app/help", icon: LifeBuoy },
  { title: "Terms of Service", href: "/app/terms", icon: FileText },
  { title: "Privacy Policy", href: "/app/privacy", icon: ShieldCheck },
];

function LinkItem({ link }: { link: MenuLink }) {
  const Icon = link.icon;
  return (
    <DropdownMenuItem
      render={
        <Link href={link.href}>
          <Icon />
          {link.title}
        </Link>
      }
    />
  );
}

/** The signed-in person, top right: who they are, shortcuts and sign out. */
export function UserMenu() {
  const { me, logout } = useSession();
  const pathname = usePathname();
  const { user } = me;
  const workspace = me.activeWorkspace;
  const inAdmin = pathname.startsWith("/admin");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Account menu"
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {user.name.trim().charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="grid gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">
              {user.name}
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {user.email}
            </span>
            {workspace && (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {workspace.name}
                {me.role ? ` · ${me.role.toLowerCase()}` : ""}
              </span>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {workspace && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {WORKSPACE_LINKS.map((link) => (
                <LinkItem key={link.href} link={link} />
              ))}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {HELP_LINKS.map((link) => (
            <LinkItem key={link.href} link={link} />
          ))}
        </DropdownMenuGroup>
        {user.isPlatformAdmin && (
          <>
            <DropdownMenuSeparator />
            <LinkItem
              link={
                inAdmin && workspace
                  ? { title: "Back to my dashboard", href: "/app", icon: LayoutDashboard }
                  : { title: "Platform admin", href: "/admin", icon: Shield }
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
