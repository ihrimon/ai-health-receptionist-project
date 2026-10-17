/**
 * "Verify installation" (FR-3.5, M4-14): the Install page's status line,
 * from the API's `installVerifiedAt` / `installVerifiedHost` (set the
 * first time the widget loads inside one of the allowed domains).
 */
export interface InstallStatus {
  installed: boolean;
  title: string;
  detail: string;
}

export function installStatus(
  verifiedAt: string | null,
  host: string | null,
  formatDate: (date: Date) => string = (d) =>
    d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
): InstallStatus {
  if (!verifiedAt) {
    return {
      installed: false,
      title: "Not detected yet",
      detail:
        "Add the code to your site, then open a page there. This updates when the chat loads on one of your allowed domains.",
    };
  }
  const when = formatDate(new Date(verifiedAt));
  return {
    installed: true,
    title: "Installed",
    detail: host ? `First seen on ${host} at ${when}.` : `First seen at ${when}.`,
  };
}
