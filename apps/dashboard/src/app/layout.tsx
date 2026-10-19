import type { Metadata } from "next";
import { headers } from "next/headers";
import {
  DM_Sans,
  Geist_Mono,
  Inter,
  Lora,
  Manrope,
  Plus_Jakarta_Sans,
  Poppins,
} from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  THEME_INIT_SCRIPT,
  ThemeSettingsProvider,
} from "@/lib/theme-settings";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// The other choices in the appearance panel. preload is off so a visitor
// only downloads one of them if they pick it.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
});
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  preload: false,
});
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  preload: false,
});
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  preload: false,
});
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BrainStack AI Receptionist",
  description: "An AI assistant for your website that answers visitors from your own content",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Reading the request headers makes every page render per request, so
  // each response carries its own CSP nonce (M7-26, src/proxy.ts); a
  // prerendered page could not have one. next-themes' inline script needs
  // the nonce passed by hand.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${poppins.variable} ${jakarta.variable} ${dmSans.variable} ${manrope.variable} ${lora.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Paints the saved accent color before React loads (no flash). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          nonce={nonce}
          disableTransitionOnChange
        >
          <ThemeSettingsProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </ThemeSettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
