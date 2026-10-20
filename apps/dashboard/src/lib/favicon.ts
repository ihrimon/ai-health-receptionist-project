/**
 * The browser-tab icon follows the dashboard color: the same robot as
 * `app/icon.svg`, with the accent as background and the readable text color
 * (`textOn`) for the drawing.
 */
export function faviconSvg(brand: string, ink: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">` +
    `<rect width="24" height="24" rx="6" fill="${brand}"/>` +
    `<g fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M12 6.5V4.2"/><circle cx="12" cy="3.6" r="0.9" fill="${ink}" stroke="none"/>` +
    `<rect x="5" y="6.5" width="14" height="10.5" rx="3.2"/><path d="M3.2 11v2.4M20.8 11v2.4"/></g>` +
    `<circle cx="9.4" cy="11.4" r="1.25" fill="${ink}"/><circle cx="14.6" cy="11.4" r="1.25" fill="${ink}"/>` +
    `<path d="M9.6 14.4h4.8" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M9 17l-1.2 3 3.4-2.2" fill="${ink}"/></svg>`
  );
}

export function faviconDataUrl(brand: string, ink: string): string {
  return `data:image/svg+xml,${encodeURIComponent(faviconSvg(brand, ink))}`;
}

/** Points every tab-icon link at the themed icon (adds one if the page has none). */
export function applyFavicon(brand: string, ink: string): void {
  const href = faviconDataUrl(brand, ink);
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel~="icon"]',
  );
  if (links.length === 0) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = href;
    document.head.appendChild(link);
    return;
  }
  links.forEach((link) => {
    link.type = "image/svg+xml";
    link.href = href;
  });
}
