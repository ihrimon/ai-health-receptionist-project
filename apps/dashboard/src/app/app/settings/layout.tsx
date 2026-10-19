/**
 * Settings sections are sub-routes listed under Settings in the sidebar
 * (Chatbot, Add API Key, Install Chatbot, Workspace), so each has its own
 * link; this only gives them a common width.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 sm:p-6">
      {children}
    </div>
  );
}
