/**
 * One order status model for the whole app.
 *
 * Banxa reports status in several vocabularies:
 *   - webhooks (rampMessage):            PAYMENT_RECEIVED, IN_PROGRESS, COIN_TRANSFERRED, FULFILLED …
 *   - GET /eapi/v0/ramps/{id}:           INITIALIZED, AWAITING_FUNDS, FUNDS_RECEIVED, UNDER_REVIEW, COMPLETED …
 *   - GET /eapi/v0/ramps (list):         pending, processing, completed, cancelled, failed
 *   - Partner API (v2) orders:           pendingPayment, paymentReceived, cryptoTransferComplete, complete …
 * Everything is mapped onto `AppStatus` before it is stored or shown.
 */

export const APP_STATUSES = [
  "AWAITING_PAYMENT",
  "PAYMENT_RECEIVED",
  "PROCESSING",
  "SENDING_CRYPTO",
  "CRYPTO_SENT",
  "COMPLETE",
  "NEEDS_VERIFICATION",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "REFUNDED",
] as const;

export type AppStatus = (typeof APP_STATUSES)[number];

const STATUS_MAP: Record<string, AppStatus> = {
  // Native API (v0): webhooks and GET /ramps/{id}
  INITIALIZED: "AWAITING_PAYMENT",
  PAYMENT_READY: "AWAITING_PAYMENT",
  AWAITING_FUNDS: "AWAITING_PAYMENT",
  PAYMENT_SUBMITTED: "AWAITING_PAYMENT",
  PAYMENT_ACCEPTED: "PAYMENT_RECEIVED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  FUNDS_RECEIVED: "PAYMENT_RECEIVED",
  IN_PROGRESS: "PROCESSING",
  UNDER_REVIEW: "NEEDS_VERIFICATION",
  EXTRA_VERIFICATION: "NEEDS_VERIFICATION",
  COIN_TRANSFERRED: "CRYPTO_SENT",
  FULFILLED: "COMPLETE",
  COMPLETED: "COMPLETE",
  PAYMENT_DECLINED: "FAILED",
  ACCOUNT_BLOCKED: "FAILED",
  PAYMENT_CANCELLED: "CANCELLED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  REFUNDED: "REFUNDED",
  // Native API (v0): GET /ramps list
  pending: "AWAITING_PAYMENT",
  processing: "PROCESSING",
  completed: "COMPLETE",
  failed: "FAILED",
  // Partner API (v2)
  pendingPayment: "AWAITING_PAYMENT",
  paymentReceived: "PAYMENT_RECEIVED",
  inProgress: "PROCESSING",
  cryptoTransferInitiated: "SENDING_CRYPTO",
  cryptoTransferPending: "SENDING_CRYPTO",
  cryptoTransferComplete: "CRYPTO_SENT",
  complete: "COMPLETE",
  declined: "FAILED",
  cancelled: "CANCELLED",
  expired: "EXPIRED",
  refunded: "REFUNDED",
};

/** Map a Banxa status string to an AppStatus. Null for statuses we don't recognise: keep the current status. */
export function toAppStatus(banxaStatus: string): AppStatus | null {
  return STATUS_MAP[banxaStatus] ?? null;
}

/** Position on the happy path. Used to ignore out-of-order webhooks. */
const PROGRESS: Partial<Record<AppStatus, number>> = {
  AWAITING_PAYMENT: 0,
  PAYMENT_RECEIVED: 1,
  PROCESSING: 2,
  SENDING_CRYPTO: 3,
  CRYPTO_SENT: 4,
  COMPLETE: 5,
};

const TERMINAL: AppStatus[] = ["COMPLETE", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"];

export const isTerminal = (s: AppStatus) => TERMINAL.includes(s);
export const isFailure = (s: AppStatus) => s === "FAILED" || s === "CANCELLED" || s === "EXPIRED";

/**
 * Whether an order may move from `current` to `next`. Equal is allowed (late data such as a tx hash).
 * Webhooks are retried for hours and can arrive out of order, so a late failure must not
 * overwrite progress: failures only apply before payment is received.
 */
export function canTransition(current: AppStatus, next: AppStatus): boolean {
  if (next === "REFUNDED") return current !== "REFUNDED";
  if (isTerminal(current)) return false;
  if (isFailure(next)) return current === "AWAITING_PAYMENT" || current === "NEEDS_VERIFICATION";
  if (next === "NEEDS_VERIFICATION" || current === "NEEDS_VERIFICATION") return true;
  return (PROGRESS[next] ?? 0) >= (PROGRESS[current] ?? 0);
}

/** Progress through the delivery timeline, 0..5. */
export const progressOf = (s: AppStatus) => PROGRESS[s] ?? 0;

export const STATUS_LABEL: Record<AppStatus, string> = {
  AWAITING_PAYMENT: "Waiting for payment",
  PAYMENT_RECEIVED: "Payment received",
  PROCESSING: "Processing",
  SENDING_CRYPTO: "Sending crypto",
  CRYPTO_SENT: "Crypto sent",
  COMPLETE: "Complete",
  NEEDS_VERIFICATION: "Action needed",
  FAILED: "Payment failed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  REFUNDED: "Refunded",
};
