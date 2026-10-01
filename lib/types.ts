export type Lang = "es" | "en";
export type DocKind = "invoice" | "estimate";
export type DocStatus = "draft" | "sent" | "paid" | "void" | "accepted";

/**
 * Where a price came from. "said": the owner said it (checked against what was heard).
 * "catalog": a price he charged before. "suggested": the estimator's guess, which he must confirm.
 * "typed": he typed or changed it himself.
 */
export type PriceSource = "said" | "catalog" | "suggested" | "typed";

export interface LineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
  source: PriceSource;
  /** Why the estimator picked this price (only for suggested prices). */
  basis?: string;
}

export type LateFee =
  | { type: "none" }
  | { type: "flat"; amountCents: number; graceDays: number }
  | { type: "percent"; percent: number; graceDays: number };

export interface PaymentMethods {
  check?: { enabled: boolean; payableTo: string };
  zelle?: { enabled: boolean; handle: string };
  bank?: { enabled: boolean; details: string };
  cash?: { enabled: boolean };
  card?: { enabled: boolean; link: string };
  other?: { enabled: boolean; text: string };
}

export interface Business {
  name: string;
  ownerName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

export interface Customer {
  name: string;
  company: string;
  email: string;
  phone: string;
}

export interface Settings extends Business {
  hasLogo: boolean;
  lang: Lang;
  state: string;
  taxEnabled: boolean;
  taxRate: number;
  dueDays: number;
  reminderDays: number;
  lateFee: LateFee;
  paymentMethods: PaymentMethods;
  onboarded: boolean;
}

export interface Doc {
  id: string;
  kind: DocKind;
  number: string;
  status: DocStatus;
  customer: Customer;
  business: Business;
  lang: Lang;
  items: LineItem[];
  state: string;
  taxRate: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  issueDate: string;
  dueDate: string;
  reminderDays: number;
  lateFee: LateFee;
  paymentMethods: PaymentMethods;
  notes: string;
  publicToken: string;
  sentAt: string | null;
  paidAt: string | null;
  lastReminderAt: string | null;
  reminderCount: number;
  createdAt: string;
}

export const REMINDER_CHOICES = [0, 3, 7, 14, 30] as const;
