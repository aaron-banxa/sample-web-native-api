import "server-only";
import type { MethodId, Rail } from "@/config/onramp";
import { db, now } from "@/lib/db";
import type { OrderSummary, OrderView, PaymentSession } from "@/lib/types";
import type { AppStatus } from "@/modules/fulfilment/status";

export interface Order extends OrderView {
  customerId: string;
  banxaOrderId: string;
}

interface Row {
  id: string;
  customer_id: string;
  banxa_order_id: string;
  rail: Rail;
  method: MethodId;
  status: AppStatus;
  fiat: string;
  fiat_amount: string;
  crypto: string;
  blockchain: string;
  crypto_amount: string | null;
  wallet_address: string;
  tx_hash: string | null;
  payment: string;
  created_at: string;
  updated_at: string;
}

const toOrder = (r: Row, statusTimes: OrderView["statusTimes"] = {}): Order => ({
  id: r.id,
  customerId: r.customer_id,
  banxaOrderId: r.banxa_order_id,
  rail: r.rail,
  method: r.method,
  status: r.status,
  fiat: r.fiat,
  fiatAmount: r.fiat_amount,
  crypto: r.crypto,
  blockchain: r.blockchain,
  cryptoAmount: r.crypto_amount,
  walletAddress: r.wallet_address,
  txHash: r.tx_hash,
  payment: JSON.parse(r.payment) as PaymentSession,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  statusTimes,
});

/** Record the first time an order reached a status (shown on the delivery timeline). */
const recordStatus = (orderId: string, status: AppStatus, at: string) =>
  db().prepare("INSERT OR IGNORE INTO order_events (order_id, status, at) VALUES (?, ?, ?)").run(orderId, status, at);

function withStatusTimes(row: Row): Order {
  const events = db().prepare("SELECT status, at FROM order_events WHERE order_id = ?").all(row.id) as unknown as { status: AppStatus; at: string }[];
  return toOrder(row, Object.fromEntries(events.map((e) => [e.status, e.at])));
}

/** The browser-safe view of an order. */
export const toOrderView = ({ customerId: _c, banxaOrderId: _b, ...view }: Order): OrderView => view;

export function insertOrder(o: Omit<Order, "createdAt" | "updatedAt" | "txHash" | "statusTimes">): Order {
  const ts = now();
  db()
    .prepare(
      `INSERT INTO orders (id, customer_id, banxa_order_id, rail, method, status, fiat, fiat_amount, crypto, blockchain, crypto_amount, wallet_address, payment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(o.id, o.customerId, o.banxaOrderId, o.rail, o.method, o.status, o.fiat, o.fiatAmount, o.crypto, o.blockchain, o.cryptoAmount, o.walletAddress, JSON.stringify(o.payment), ts, ts);
  recordStatus(o.id, o.status, ts);
  return { ...o, txHash: null, createdAt: ts, updatedAt: ts, statusTimes: { [o.status]: ts } };
}

export function findOrder(id: string): Order | null {
  const row = db().prepare("SELECT * FROM orders WHERE id = ?").get(id) as Row | undefined;
  return row ? withStatusTimes(row) : null;
}

export function findOrderByBanxaId(banxaOrderId: string): Order | null {
  const row = db().prepare("SELECT * FROM orders WHERE banxa_order_id = ?").get(banxaOrderId) as Row | undefined;
  return row ? withStatusTimes(row) : null;
}

export function updateOrder(id: string, patch: { status: AppStatus; cryptoAmount?: string | null; txHash?: string | null }): Order {
  const ts = now();
  db()
    .prepare("UPDATE orders SET status = ?, crypto_amount = COALESCE(?, crypto_amount), tx_hash = COALESCE(?, tx_hash), updated_at = ? WHERE id = ?")
    .run(patch.status, patch.cryptoAmount ?? null, patch.txHash ?? null, ts, id);
  recordStatus(id, patch.status, ts);
  return findOrder(id)!;
}

export function listCustomerOrders(customerId: string, limit = 20): OrderSummary[] {
  const rows = db().prepare("SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?").all(customerId, limit) as unknown as Row[];
  return rows.map((r) => toOrder(r)).map((o) => ({
    id: o.id,
    status: o.status,
    method: o.method,
    fiat: o.fiat,
    fiatAmount: o.fiatAmount,
    crypto: o.crypto,
    cryptoAmount: o.cryptoAmount,
    createdAt: o.createdAt,
  }));
}

/** Orders that may still change: not in a final state and created within `days`. */
export function listOpenOrders(days: number, customerId?: string): Order[] {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const terminal = "('COMPLETE','FAILED','CANCELLED','EXPIRED','REFUNDED')";
  const rows = (
    customerId
      ? db().prepare(`SELECT * FROM orders WHERE customer_id = ? AND created_at >= ? AND status NOT IN ${terminal}`).all(customerId, since)
      : db().prepare(`SELECT * FROM orders WHERE created_at >= ? AND status NOT IN ${terminal}`).all(since)
  ) as unknown as Row[];
  return rows.map((r) => toOrder(r));
}
