/**
 * Step-by-step install guides on the Install page (FR-3.3, M4-15, D-3 §3.5):
 * where to paste the snippet on a plain HTML site, Shopify and
 * WooCommerce/WordPress, written for someone who has never edited code.
 * Text in `backticks` is shown as code; a step with `snippet: true` shows the
 * company's own snippet with a copy button under it.
 */
export type InstallPlatform = "html" | "shopify" | "wordpress";

export interface InstallStep {
  text: string;
  snippet?: boolean;
}

export interface InstallGuide {
  id: InstallPlatform;
  label: string;
  intro: string;
  steps: InstallStep[];
  tips: string[];
}

const PASTE = "Paste the code below on a new line just above `</body>`:";
const DOMAIN_TIP =
  "If your site opens both with and without www, add both (for example `shop.com` and `www.shop.com`) under Allowed domains.";

export const INSTALL_GUIDES: InstallGuide[] = [
  {
    id: "html",
    label: "HTML",
    intro: "For a site made of HTML files you edit and upload yourself.",
    steps: [
      {
        text: "Open the HTML file of a page where the chat should appear. If your pages share a footer file (such as `footer.html` or `footer.php`), open that one instead so every page gets the chat.",
      },
      {
        text: "Find the closing `</body>` tag near the end of the file (press Ctrl+F, or Cmd+F on a Mac, and search for it).",
      },
      { text: PASTE, snippet: true },
      {
        text: "Save the file and upload it to your web host the way you normally update your site.",
      },
      {
        text: "Open the page in your browser. A chat button appears in the bottom corner. Then come back here and click Check again.",
      },
    ],
    tips: [
      "Without a shared footer file, repeat these steps on every page that should show the chat.",
      DOMAIN_TIP,
    ],
  },
  {
    id: "shopify",
    label: "Shopify",
    intro: "Adds the chat to every page of your store through your theme.",
    steps: [
      { text: "Log in to your Shopify admin and go to Online Store → Themes." },
      {
        text: "Next to your current theme, click the ⋯ (three dots) button, then Edit code.",
      },
      { text: "In the file list on the left, under Layout, click `theme.liquid`." },
      {
        text: "Click inside the code, press Ctrl+F (Cmd+F on a Mac) and search for `</body>`.",
      },
      { text: PASTE, snippet: true },
      {
        text: "Click Save, then open your store in a new tab. A chat button appears in the bottom corner. Come back here and click Check again.",
      },
    ],
    tips: [
      "Add every address your store opens on under Allowed domains: your own domain (and its www version) and, if visitors use it, `your-store.myshopify.com`.",
      "If you switch to another theme or install a theme update, paste the code into its `theme.liquid` again.",
      "Shopify's checkout pages don't use your theme, so the chat doesn't show there.",
    ],
  },
  {
    id: "wordpress",
    label: "WooCommerce / WordPress",
    intro:
      "Uses a free plugin to add the code to every page, so a theme update doesn't remove it. Works the same for WooCommerce shops.",
    steps: [
      {
        text: "Log in to your WordPress admin (usually `your-site.com/wp-admin`) and go to Plugins → Add New Plugin.",
      },
      {
        text: "Search for WPCode (it is called \"WPCode – Insert Headers and Footers\"), then click Install Now and Activate.",
      },
      { text: "In the left menu, go to Code Snippets → Header & Footer." },
      { text: "Paste the code below into the Footer box:", snippet: true },
      {
        text: "Click Save Changes, then open your site in a new tab. A chat button appears in the bottom corner. Come back here and click Check again.",
      },
    ],
    tips: [
      "Already using a header and footer plugin (or your theme has a \"footer scripts\" setting)? Paste the code into its footer box instead; you don't need WPCode.",
      "If you use a caching plugin (such as WP Rocket or W3 Total Cache), clear its cache after saving, or the chat may not show yet.",
      "On WordPress.com (not self-hosted WordPress), installing plugins needs a paid plan that allows plugins.",
      DOMAIN_TIP,
    ],
  },
];

/** Splits text into plain and `code` parts for display. */
export function splitInlineCode(text: string): { text: string; code: boolean }[] {
  return text
    .split("`")
    .map((part, i) => ({ text: part, code: i % 2 === 1 }))
    .filter((part) => part.text !== "");
}
