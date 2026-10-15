import { redirect } from "next/navigation";

/** The platform-admin area is just the LLM keys page for now. */
export default function AdminHomePage() {
  redirect("/admin/settings");
}
