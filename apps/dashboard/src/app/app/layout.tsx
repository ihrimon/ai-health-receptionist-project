import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/toast";
import { SiteHeader } from "@/components/site-header";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspaceSuspendedGate } from "@/components/workspace-suspended-gate";
import { ChatbotProvider } from "@/lib/chatbot";
import { SessionProvider } from "@/lib/session";

function LoadingShell() {
  return (
    <div className="flex flex-1 gap-4 p-4">
      <Skeleton className="hidden h-full w-60 md:block" />
      <div className="flex flex-1 flex-col gap-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

/** M1-27: the signed-in company dashboard (D-3 §1.2). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<LoadingShell />}>
      <WorkspaceSuspendedGate>
      <ChatbotProvider>
        <SidebarProvider>
          <WorkspaceSidebar />
          <SidebarInset className="min-h-0">
            <SiteHeader withPublishBanner />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {children}
            </div>
          </SidebarInset>
          <Toaster />
        </SidebarProvider>
      </ChatbotProvider>
      </WorkspaceSuspendedGate>
    </SessionProvider>
  );
}
