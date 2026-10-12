import { redirect } from "next/navigation";

// The old single-password admin login. Everyone signs in at /login now
// (M1-21/M1-26); kept so old bookmarks still land somewhere useful.
export default function AdminLoginRedirect() {
  redirect("/login");
}
