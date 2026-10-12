import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/toast";
import { AppSidebar } from "@/components/app-sidebar";
import { PlatformAdminGate } from "@/components/platform-admin-gate";
import { SiteHeader } from "@/components/site-header";
import { SessionProvider } from "@/lib/session";

/**
 * Platform admin area. Becomes the super-admin console in M7-0
 * (docs/design/d3-screens.md §1.3).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<Skeleton className="m-4 h-40" />}>
      <PlatformAdminGate>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-h-0">
            <SiteHeader />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {children}
            </div>
          </SidebarInset>
          <Toaster />
        </SidebarProvider>
      </PlatformAdminGate>
    </SessionProvider>
  );
}
