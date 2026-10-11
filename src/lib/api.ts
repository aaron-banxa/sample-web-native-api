/** Browser-side calls to this app's own API routes. Never calls Banxa directly. */

import type { CustomerView, EligibilityView, LimitsView, LockedQuoteView, OrderDraft, OrderSummary, OrderView, QuoteView } from "@/lib/types";

/** A request cancelled by its AbortController (the component unmounted or its inputs changed). */
export const isAbort = (err: unknown) => err instanceof Error && err.name === "AbortError";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: { path: string; message: string }[],
    /** Machine-readable reason, e.g. "verify_email". */
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(data?.error ?? "Request failed", res.status, data?.details, data?.code);
  return data as T;
}

export interface IdentityForm {
  email: string;
  givenName: string;
  surname: string;
  dateOfBirth: string;
  country: string;
  state?: string;
  consent: boolean;
}

export interface DueDiligenceAnswers {
  occupationIndustry?: string;
  occupation?: string;
  sourceOfFunds?: string;
  purposeOfTransaction?: string;
  taxIdType?: string;
  taxId?: string;
  residentialAddress?: { addressLine: string; suburb: string; state: string; postCode: string; country: string };
}

export type KycStatus = "PENDING" | "UNDER_REVIEW" | "ACTION_REQUIRED" | "VERIFIED" | "REJECTED" | null;

export const api = {
  quote: ({ fiat, amountType, fiatAmount, cryptoAmount, crypto, blockchain, method }: OrderDraft, signal?: AbortSignal) =>
    request<QuoteView>(`/api/quote?${new URLSearchParams({ fiat, amountType, fiatAmount, cryptoAmount, crypto, blockchain, method })}`, { signal }),
  lockQuote: (draft: OrderDraft, signal?: AbortSignal) => request<LockedQuoteView>("/api/quote/lock", { method: "POST", body: { draft }, signal }),
  limits: ({ fiat, method, crypto, blockchain }: OrderDraft, signal?: AbortSignal) =>
    request<LimitsView>(`/api/limits?${new URLSearchParams({ fiat, method, crypto, blockchain })}`, { signal }),
  shareKyc: () => request<{ kycStatus: KycStatus }>("/api/identity/kyc-share", { method: "POST", body: {} }),
  kycStatus: (draft: OrderDraft) => request<{ kycStatus: KycStatus; eligibility: EligibilityView | null }>("/api/identity/kyc-status", { method: "POST", body: { draft } }),
  orders: () => request<OrderSummary[]>("/api/orders"),
  me: () => request<CustomerView | null>("/api/identity"),
  register: (form: IdentityForm) => request<CustomerView>("/api/identity", { method: "POST", body: form }),
  forget: () => request<null>("/api/identity", { method: "DELETE" }),
  verifyEmail: (email: string, code: string) => request<CustomerView>("/api/identity/verify", { method: "POST", body: { email, code } }),
  eligibility: (draft: OrderDraft, signal?: AbortSignal) => request<EligibilityView>("/api/eligibility", { method: "POST", body: { draft }, signal }),
  dueDiligence: (answers: DueDiligenceAnswers, draft: OrderDraft) =>
    request<EligibilityView>("/api/due-diligence", { method: "POST", body: { answers, draft } }),
  createOrder: (draft: OrderDraft, idempotencyKey: string, quoteId?: string) =>
    request<OrderView>("/api/orders", { method: "POST", body: { draft, idempotencyKey, quoteId } }),
  order: (id: string) => request<OrderView>(`/api/orders/${encodeURIComponent(id)}`),
  mockPay: (orderId: string) => request<{ ok: true }>("/api/mock/payment", { method: "POST", body: { orderId } }),
};
