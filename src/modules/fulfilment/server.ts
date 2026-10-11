import "server-only";
import { banxa } from "@/lib/banxa";
import { db, now } from "@/lib/db";
import { findOrder, findOrderByBanxaId, toOrderView, updateOrder, type Order } from "@/modules/order/orders";
import { publish } from "./events";
import { canTransition, isTerminal, toAppStatus } from "./status";

/**
 * Step 7 · Fulfilment
 * Banxa owns the order after payment. Updates arrive as webhooks (primary) or from
 * polling Banxa (fallback); both go through `applyBanxaUpdate`.
 */

/** Ramp status webhook (rampMessage). */
export interface BanxaRampWebhook {
  order_id: string;
  status: string;
  crypto_amount?: string;
  transaction_hash?: string;
  external_id?: string | null;
  [key: string]: unknown;
}

/** Identity webhook (identityMessage), e.g. ACCOUNT_BLOCKED. */
export interface BanxaIdentityWebhook {
  identity_reference: string;
  status: string;
  status_date?: string;
  [key: string]: unknown;
}

/**
 * Banxa may deliver the same event more than once.
 * `order_id:status` (or `identity:<ref>:<status>`) identifies a state change.
 */
export function alreadyProcessed(key: string): boolean {
  return !!db().prepare("SELECT 1 FROM webhook_events WHERE dedupe_key = ?").get(key);
}

/** Record only after the event is applied, so a failed apply is retried by Banxa. */
export function markProcessed(key: string, subject: string, status: string, rawBody: string) {
  db()
    .prepare("INSERT OR IGNORE INTO webhook_events (dedupe_key, subject, status, payload, received_at) VALUES (?, ?, ?, ?, ?)")
    .run(key, subject, status, rawBody, now());
}

/** Apply a Banxa status to our order: map it, ignore out-of-order updates, save, push to the browser. */
export function applyBanxaUpdate(update: {
  banxaOrderId: string;
  /** Our order id, echoed by Banxa as external_id on Partner API orders. */
  externalOrderId?: string | null;
  status: string;
  cryptoAmount?: string;
  transactionHash?: string;
}): Order | null {
  const order = findOrderByBanxaId(update.banxaOrderId) ?? (update.externalOrderId ? findOrder(update.externalOrderId) : null);
  if (!order) {
    console.warn(`[fulfilment] update for unknown Banxa order ${update.banxaOrderId}`);
    return null;
  }

  const next = toAppStatus(update.status);
  if (!next) {
    console.warn(`[fulfilment] unrecognised Banxa status "${update.status}" for ${order.id}; keeping ${order.status}`);
    return order;
  }
  if (!canTransition(order.status, next)) return order;

  const saved = updateOrder(order.id, {
    status: next,
    cryptoAmount: update.cryptoAmount || null,
    txHash: update.transactionHash || null,
  });
  publish(toOrderView(saved));
  return saved;
}

/** Fallback when webhooks can't reach you (e.g. local sandbox without a tunnel): ask Banxa directly. */
export async function reconcileWithBanxa(order: Order): Promise<void> {
  if (isTerminal(order.status)) return;
  try {
    const remote = await banxa.getOrderStatus(order.banxaOrderId, order.rail);
    if (remote) applyBanxaUpdate({ banxaOrderId: order.banxaOrderId, ...remote });
  } catch (err) {
    console.warn(`[fulfilment] could not reconcile ${order.id}`, err instanceof Error ? err.message : err);
  }
}
