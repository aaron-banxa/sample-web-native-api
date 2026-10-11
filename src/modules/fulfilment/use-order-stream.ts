"use client";

import { useEffect, useState } from "react";
import type { OrderView } from "@/lib/types";
import { isTerminal } from "./status";

/**
 * Live order from this app's server (GET /api/orders/:id/events, Server-Sent Events).
 * The server pushes every change it receives from Banxa webhooks. EventSource reconnects on its own.
 */
export function useOrderStream(initial: OrderView): OrderView {
  const [order, setOrder] = useState(initial);

  useEffect(() => {
    if (isTerminal(initial.status)) return;
    const source = new EventSource(`/api/orders/${encodeURIComponent(initial.id)}/events`);
    source.onmessage = (e) => {
      const next = JSON.parse(e.data) as OrderView;
      setOrder(next);
      if (isTerminal(next.status)) source.close();
    };
    return () => source.close();
    // Reconnect only when the order changes, not on every status update.
  }, [initial.id]);

  return order;
}
