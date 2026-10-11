"use client";

import { useEffect } from "react";
import type { OrderView } from "@/lib/types";
import { isTerminal } from "./status";

/**
 * Follow an order live (GET /api/orders/:id/events, Server-Sent Events). The server sends the
 * current order, then every change it receives from Banxa webhooks. EventSource reconnects on its own.
 * Pass null to close the connection. Closes by itself once the order reaches a final state.
 */
export function useOrderStream(order: OrderView | null, onUpdate: (order: OrderView) => void) {
  const id = order?.id;
  const live = !!order && !isTerminal(order.status);

  useEffect(() => {
    if (!id || !live) return;
    const source = new EventSource(`/api/orders/${encodeURIComponent(id)}/events`);
    source.onmessage = (e) => onUpdate(JSON.parse(e.data) as OrderView);
    return () => source.close();
    // Reconnect only when the order changes or finishes, not on every status update.
  }, [id, live, onUpdate]);
}
