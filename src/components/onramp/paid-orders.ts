import type { OrderView } from "@/lib/types";

/**
 * Orders this browser already paid for (the payment sheet said "authorised"), so reopening one shows
 * delivery instead of the payment sheet again. A session cookie, so the server can read it when it
 * renders a restored order.
 */
export const PAID_COOKIE = "onramp_paid";
const KEEP = 10;

export const parsePaid = (value: string | undefined): string[] => (value ? value.split(".") : []);

const readPaid = () => parsePaid(document.cookie.match(new RegExp(`(?:^|; )${PAID_COOKIE}=([^;]*)`))?.[1]);

/** Browser only. */
export function markPaid(orderId: string) {
  const ids = [...readPaid().filter((id) => id !== orderId), orderId].slice(-KEEP);
  document.cookie = `${PAID_COOKIE}=${ids.join(".")}; path=/; SameSite=Lax`;
}

/** Where to resume an existing order: the payment step if it still needs paying here, otherwise delivery. */
export function resumeStepFor(order: OrderView, paidIds: string[] = readPaid()): "payment" | "delivery" {
  const needsPaying = order.status === "AWAITING_PAYMENT" && order.payment.mode !== "hosted" && !paidIds.includes(order.id);
  return needsPaying ? "payment" : "delivery";
}
