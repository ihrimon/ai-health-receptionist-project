/**
 * The answer-quality check for the chat pipeline (M3-15 to M3-18). A case is
 * a visitor question about one fixture company and what must hold for the
 * answer. Cases are written so a plain rule can judge them: no model grades
 * another model.
 */

export type EvalCategory =
  /** A fact written in the FAQs or policies, asked in the same words. */
  | 'answerable'
  /** The same kind of fact, asked in other words. */
  | 'paraphrase'
  /** A question a custom answer covers. */
  | 'custom_answer'
  /** Plausible for this business but not in its knowledge: must be a fallback. */
  | 'unknown'
  /** Nothing to do with the business: must be a fallback. */
  | 'offtopic'
  /** Tries to override the rules or read another company's data. */
  | 'injection'
  /** Price or stock of a product. */
  | 'price_stock'
  /** Asks for another company's information. */
  | 'cross_tenant'
  /** Greetings and thanks. */
  | 'smalltalk';

/** Where the answer must come from. */
export type EvalRoute = 'custom_answer' | 'fallback' | 'model';

export interface EvalCase {
  id: string;
  category: EvalCategory;
  question: string;
  route: EvalRoute;
  /**
   * Meaning alone can't tell this question from one the knowledge answers
   * (a gaming console question to an electronics shop), so the server may
   * let it reach the model; a real model must then give the fallback. With
   * the stand-in model both are accepted: isolation is still judged.
   */
  modelDecides?: boolean;
  /**
   * route `model`: pieces of the company's knowledge that must reach the
   * model. Checked on what is sent to it, so it holds with or without a
   * real model.
   */
  context?: string[];
  /** route `model`, real model only: the answer must contain each of these. */
  answerIncludes?: string[];
  /**
   * Other companies' facts, or text that must never be revealed: none may
   * appear in the answer or in what the model is sent.
   */
  forbidden?: string[];
  /**
   * Text that is fine inside the model's instructions but must not come
   * out in the answer (the rules, the knowledge tags, a price the company
   * never set).
   */
  secrets?: string[];
  /** A product tool search must put this product first. */
  productSearch?: { query: string; expectFirst: string };
}

/** What running one case produced. */
export interface CaseOutcome {
  answeredBy: 'llm' | 'custom_answer' | 'fallback' | null;
  reply: string;
  /** Everything sent to the model for this question, as one text. */
  modelContext: string;
  /** The first product `search_products` found, when the case asks for it. */
  productFirst: string | null;
  /** The answer came from a real model, not the stand-in. */
  realModel: boolean;
}

export interface CaseVerdict {
  pass: boolean;
  /** Nothing could be judged without a real model. */
  skipped: boolean;
  failures: string[];
  /** A forbidden text reached the answer or the model. */
  leak: boolean;
  /** The answer states a price that no product or text of the company has. */
  inventedPrice: boolean;
}

export interface FixtureCompany {
  key: 'clothing' | 'electronics' | 'services';
  name: string;
  description: string;
  currency: string;
  faqs: { question: string; answer: string }[];
  policies: { title: string; content: string }[];
  customAnswers: { triggerQuestion: string; answer: string }[];
  products: {
    name: string;
    sku: string;
    price: string;
    category: string;
    description: string;
    stockStatus: 'IN_STOCK' | 'OUT_OF_STOCK' | 'PREORDER';
  }[];
  cases: EvalCase[];
}
