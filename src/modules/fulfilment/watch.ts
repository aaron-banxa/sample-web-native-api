import "server-only";
import { isMock } from "@/lib/banxa";
import type { OrderView } from "@/lib/types";
import { findOrder } from "@/modules/order/orders";
import { subscribe } from "./events";
import { reconcileWithBanxa } from "./server";
import { isTerminal } from "./status";

const RECONCILE_MS = 15_000;

interface Poller {
  viewers: number;
  timer: ReturnType<typeof setInterval>;
}

/** One Banxa poller per order, however many browser tabs are following it. */
const pollers: Map<string, Poller> = ((globalThis as { __orderPollers?: Map<string, Poller> }).__orderPollers ??= new Map());

/**
 * Follow an order: `listener` receives every update (pushed by the webhook handler).
 * Outside mock mode, Banxa is also asked every 15s while anyone is watching, in case webhooks
 * can't reach this server. Returns a function that stops watching.
 */
export function watchOrder(orderId: string, listener: (order: OrderView) => void): () => void {
  const unsubscribe = subscribe(orderId, listener);
  const release = isMock ? () => {} : joinPoller(orderId);
  return () => {
    unsubscribe();
    release();
  };
}

function joinPoller(orderId: string): () => void {
  const joined = pollers.get(orderId) ?? startPoller(orderId);
  joined.viewers++;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    if (--joined.viewers <= 0) stop(orderId, joined);
  };
}

function startPoller(orderId: string): Poller {
  let busy = false; // don't stack Banxa calls if one is slow
  const poller: Poller = {
    viewers: 0,
    timer: setInterval(() => {
      const order = findOrder(orderId);
      if (!order || isTerminal(order.status)) return stop(orderId, poller);
      if (busy) return;
      busy = true;
      void reconcileWithBanxa(order).finally(() => (busy = false));
    }, RECONCILE_MS),
  };
  pollers.set(orderId, poller);
  return poller;
}

function stop(orderId: string, poller: Poller) {
  clearInterval(poller.timer);
  if (pollers.get(orderId) === poller) pollers.delete(orderId);
}
