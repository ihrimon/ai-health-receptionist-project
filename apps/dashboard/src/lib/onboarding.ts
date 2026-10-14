/**
 * The Home page checklist (D-3 §3.1, M2-17): each step is worked out from
 * real data, so it ticks itself as the company sets things up.
 */

export type StepId =
  | "account"
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
}

export function onboardingSteps(input: OnboardingInput): OnboardingStep[] {
  return [
    { id: "account", title: "Create your account", done: true, available: true, optional: false },
    {
      id: "business",
      title: "Describe your business",
      done: input.businessDescription.trim() !== "",
      available: true,
      optional: false,
      href: "/app/chatbot",
      action: "Go to Chatbot",
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
    { id: "install", title: "Install on your website", done: false, available: false, optional: false },
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
