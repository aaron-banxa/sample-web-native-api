"use client";

import { CaretRightIcon } from "@/components/ui/icons";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatFiat } from "@/lib/format";
import type { OrderSummary } from "@/lib/types";
import { Callout, Spinner } from "@/components/ui/primitives";
import { isFailure, STATUS_LABEL } from "@/modules/fulfilment/status";

/** The customer's recent orders (GET /api/orders, reconciled with Banxa outside mock mode). */
export function OrdersStep({ onOpen }: { onOpen: (orderId: string) => void }) {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.orders().then(setOrders, (err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <h2 className="step-title serif blur-in">Your orders</h2>
      <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>Your most recent purchases.</p>
      {error && <Callout tone="red">{error}</Callout>}
      {!orders && !error && <div className="center" style={{ padding: 32 }}><Spinner dark /></div>}
      {orders?.length === 0 && <Callout tone="neutral">No orders yet.</Callout>}
      {orders && orders.length > 0 && (
        <ul className="order-list blur-in" style={{ "--i": 2 } as React.CSSProperties}>
          {orders.map((o) => (
            <li key={o.id}>
              <button type="button" className="order-row" onClick={() => onOpen(o.id)}>
                <span>
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                    {o.cryptoAmount ? `${Number(o.cryptoAmount)} ` : ""}{o.crypto}
                  </span>
                  <br />
                  <span className="when">{formatFiat(o.fiatAmount, o.fiat)} · {new Date(o.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className={`tag ${o.status === "COMPLETE" ? "green" : isFailure(o.status) ? "red" : ""}`}>{STATUS_LABEL[o.status]}</span>
                  <CaretRightIcon size={14} className="faint" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
