import { redirect } from "next/navigation";

/** The platform-admin area opens on the workspace list (M7-0). */
export default function AdminHomePage() {
  redirect("/admin/workspaces");
}
