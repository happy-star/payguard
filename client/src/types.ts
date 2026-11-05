export type DealStatus =
  | "created"
  | "approved"
  | "authorized"
  | "captured"
  | "voided"
  | "cancelled"
  | "failed";

export type Confidence = "high" | "medium" | "low";
export type AiSource = "mock" | "model" | "mock-fallback";

export interface Milestone {
  id: string;
  title: string;
  condition: string;
  done: boolean;
}

export interface MilestoneDraft {
  title: string;
  condition: string;
}

export interface DealEvent {
  at: string;
  status: DealStatus;
  note: string;
}

export interface Deal {
  id: string;
  createdAt: string;
  updatedAt: string;
  prompt: string;
  title: string;
  summary: string;
  amount: string;
  currency: string;
  buyerName: string;
  freelancerName: string;
  dueDate: string | null;
  milestones: Milestone[];
  riskNotes: string[];
  missing: string[];
  confidence: Confidence;
  aiSource: AiSource;
  status: DealStatus;
  paypal: {
    mode: "mock" | "sandbox";
    orderId: string | null;
    orderStatus: string | null;
    authorizationId: string | null;
    captureId: string | null;
    approveUrl: string | null;
    payerId: string | null;
    lastError: string | null;
  };
  explanation: string;
  events: DealEvent[];
}

export interface Extraction {
  title: string;
  summary: string;
  amount: string | null;
  currency: string;
  buyerName: string;
  freelancerName: string;
  dueDate: string | null;
  milestones: MilestoneDraft[];
  riskNotes: string[];
  missing: string[];
  confidence: Confidence;
  aiSource: AiSource;
}

export interface SamplePrompt {
  id: string;
  label: string;
  blurb: string;
  prompt: string;
}

export interface Health {
  ok: boolean;
  service: string;
  paypal: "mock" | "sandbox";
  ai: "mock" | "live";
  model: string | null;
  webhookVerification: boolean;
  intent: string;
  currencies: string[];
}
