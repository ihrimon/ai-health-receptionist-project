/**
 * The Home page checklist (D-3 §3.1, M2-17): each step is worked out from
 * real data, so it ticks itself as the company sets things up.
 */

export type StepId =
  | "account"
  | "aiKey"
  | "business"
  | "knowledge"
  | "products"
  | "preview"
  | "publish"
  | "install";

export interface OnboardingStep {
  id: StepId;
  title: string;
  done: boolean;
  /** Steps whose screens come in later milestones can't be done yet. */
  available: boolean;
  optional: boolean;
  /** Where the step is done; absent for steps done in place (publish). */
  href?: string;
  action?: string;
}

export interface OnboardingInput {
  businessDescription: string;
  /** FAQs plus policy/info pages. */
  knowledgeCount: number;
  productCount: number;
  published: boolean;
  /** A key is switched on; null when the viewer can't see keys (not the owner). */
  aiKeyReady: boolean | null;
}

export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  return [
    { id: "account", title: "Create your account", done: true, available: true, optional: false },
    {
      id: "aiKey",
      title: "Add your AI API key",
      done: input.aiKeyReady === true,
      // Only the owner can add one, so others don't get stuck on it.
      available: input.aiKeyReady !== null,
      optional: false,
      href: "/app/settings/ai",
      action: "Go to AI settings",
    },
    {
      id: "business",
      title: "Describe your business",
      done: input.businessDescription.trim() !== "",
      available: true,
      optional: false,
      href: "/app/settings/chatbot",
      action: "Go to chatbot settings",
    },
    {
      id: "knowledge",
      title: "Add FAQs or policies",
      done: input.knowledgeCount > 0,
      available: true,
      optional: false,
      href: "/app/knowledge",
      action: "Go to Knowledge",
    },
    {
      id: "products",
      title: "Add products (optional)",
      done: input.productCount > 0,
      available: true,
      optional: true,
      href: "/app/products",
      action: "Go to Products",
    },
    { id: "preview", title: "Test it in the preview", done: false, available: false, optional: false },
    { id: "publish", title: "Publish", done: input.published, available: true, optional: false },
    {
      id: "install",
      title: "Install on your website",
      // Nothing tells us yet that the snippet is on a site (M4-14), so it
      // can't tick itself; optional so it doesn't hold the checklist open.
      done: false,
      available: true,
      optional: true,
      href: "/app/settings/install",
      action: "Get the code",
    },
  ];
}

export interface Progress {
  done: number;
  total: number;
  /** Every step that can be done today is done (optional ones aside). */
  readyForNow: boolean;
}

export function onboardingProgress(steps: OnboardingStep[]): Progress {
  return {
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    readyForNow: steps.every((s) => s.done || s.optional || !s.available),
  };
}
