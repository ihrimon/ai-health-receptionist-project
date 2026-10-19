import {
  BookOpen,
  Bot,
  Building2,
  CircleHelp,
  Code2,
  FileText,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MessagesSquare,
  Package,
  Settings,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavLeaf {
  title: string;
  href: string;
  icon: LucideIcon;
}

/** A menu entry that opens a list of pages (Settings, Help). */
export interface NavParent {
  title: string;
  icon: LucideIcon;
  children: NavLeaf[];
}

export type NavItem = NavLeaf | NavParent;

export function isParent(item: NavItem): item is NavParent {
  return "children" in item;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// D-3 §2, regrouped in the M7 redesign. Only pages that exist are listed.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard",
    items: [{ title: "Overview", href: "/app", icon: LayoutDashboard }],
  },
  {
    label: "Build",
    items: [
      { title: "Chatbot", href: "/app/chatbot", icon: Bot },
      { title: "Knowledge", href: "/app/knowledge", icon: BookOpen },
      { title: "Products", href: "/app/products", icon: Package },
    ],
  },
  {
    label: "Engage",
    items: [
      { title: "Conversations", href: "/app/conversations", icon: MessagesSquare },
      { title: "Leads", href: "/app/leads", icon: UserRound },
      { title: "Unanswered", href: "/app/unanswered", icon: CircleHelp },
    ],
  },
  {
    label: "Account",
    items: [
      {
        title: "Settings",
        icon: Settings,
        children: [
          { title: "Chatbot", href: "/app/settings/chatbot", icon: Bot },
          { title: "Add API Key", href: "/app/settings/ai", icon: KeyRound },
          { title: "Install Chatbot", href: "/app/settings/install", icon: Code2 },
          { title: "Workspace", href: "/app/settings/workspace", icon: Building2 },
        ],
      },
      {
        title: "Help",
        icon: LifeBuoy,
        children: [
          { title: "Help", href: "/help", icon: LifeBuoy },
          { title: "Terms of Service", href: "/terms", icon: FileText },
          { title: "Privacy Policy", href: "/privacy", icon: ShieldCheck },
        ],
      },
    ],
  },
];

export type SearchPage = NavLeaf & { section: string };

/** Every page as a flat list, for the search box. */
export function flatNav(groups: NavGroup[] = NAV_GROUPS): SearchPage[] {
  return groups.flatMap((g) =>
    g.items.flatMap((item) =>
      isParent(item)
        ? item.children.map((c) => ({ ...c, section: item.title }))
        : [{ ...item, section: g.label }],
    ),
  );
}

export const ADMIN_PAGES: SearchPage[] = [
  { title: "Workspaces", href: "/admin/workspaces", icon: Building2, section: "Platform admin" },
  { title: "Conversations", href: "/admin/conversations", icon: MessagesSquare, section: "Platform admin" },
  { title: "Usage & cost", href: "/admin/usage", icon: FileText, section: "Platform admin" },
  { title: "LLM keys", href: "/admin/llm-credentials", icon: KeyRound, section: "Platform admin" },
];

/** Active when the path is the page or below it ("/app" only matches itself). */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
