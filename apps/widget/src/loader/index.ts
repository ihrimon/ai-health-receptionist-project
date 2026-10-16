import { mountLoader } from "./loader";

// The built `chatbot.js` (vite.loader.config.ts): runs once, as a classic
// script, so `document.currentScript` is the company's tag.
mountLoader(document.currentScript as HTMLScriptElement | null, window, import.meta.env.VITE_WIDGET_URL);
