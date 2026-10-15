import { redirect } from "next/navigation";

/** /app/settings has no page of its own; open the first section. */
export default function SettingsIndex() {
  redirect("/app/settings/chatbot");
}
