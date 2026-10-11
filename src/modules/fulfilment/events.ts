import "server-only";
import type { OrderView } from "@/lib/types";

/**
 * In-process pub/sub that pushes order updates to open SSE connections.
 * Works for a single server. With several instances, replace with Redis pub/sub or similar.
 */

type Listener = (order: OrderView) => void;

const listeners: Map<string, Set<Listener>> = ((globalThis as { __orderListeners?: Map<string, Set<Listener>> }).__orderListeners ??= new Map());

export function subscribe(orderId: string, listener: Listener): () => void {
  const set = listeners.get(orderId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(orderId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(orderId);
  };
}

export function publish(order: OrderView) {
  listeners.get(order.id)?.forEach((listener) => listener(order));
}
