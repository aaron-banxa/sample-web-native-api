import "server-only";
import { banxa, isMock } from "@/lib/banxa";
import { applyBanxaUpdate, reconcileWithBanxa } from "@/modules/fulfilment/server";
import { findOrderByBanxaId, listOpenOrders } from "./orders";

/**
 * Catch up on anything webhooks missed (downtime, misconfigured URL, local development).
 *
 *   Bank-transfer ramps: page through GET /eapi/v0/ramps and apply each status to orders we know.
 *   Card / wallet orders: look up each open order on the Partner API.
 *
 * Run it on a schedule (POST /api/sync with SYNC_SECRET). Updates go through the same path as webhooks.
 */
export async function syncOrders({ maxPages = 5, perPage = 50 } = {}) {
  let rampsChecked = 0;
  let updated = 0;
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await banxa.listRamps({ cursor, perPage });
    for (const ramp of result.ramps) {
      rampsChecked++;
      const order = findOrderByBanxaId(ramp.id);
      if (!order) continue; // another system's ramp
      const saved = applyBanxaUpdate({ banxaOrderId: ramp.id, status: ramp.status, cryptoAmount: ramp.cryptoAmount, transactionHash: ramp.transactionHash });
      if (saved && saved.updatedAt !== order.updatedAt) updated++;
    }
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  const openNative = listOpenOrders(7).filter((o) => o.rail === "native");
  await Promise.all(openNative.map((o) => reconcileWithBanxa(o)));

  return { rampsChecked, nativeChecked: openNative.length, updated };
}

/** Light reconciliation before showing a customer their orders. Mock mode relies on webhooks only. */
export async function refreshCustomerOrders(customerId: string) {
  if (isMock) return;
  await Promise.all(listOpenOrders(2, customerId).map((o) => reconcileWithBanxa(o)));
}
