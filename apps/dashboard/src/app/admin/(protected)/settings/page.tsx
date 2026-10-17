import { redirect } from "next/navigation";

/** The platform LLM keys moved to /admin/llm-credentials (M6-13); this keeps old bookmarks working. */
export default function LegacyAdminSettingsPage() {
  redirect("/admin/llm-credentials");
}
