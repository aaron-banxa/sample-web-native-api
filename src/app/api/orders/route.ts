import { after, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { parseDraft } from "@/modules/order/draft";
import { listCustomerOrders, toOrderView } from "@/modules/order/orders";
import { createOrder } from "@/modules/order/server";
import { refreshCustomerOrders } from "@/modules/order/sync";

/** How long the order history waits for Banxa before answering with what it has. */
const REFRESH_WAIT_MS = 2_000;

/** GET /api/orders – the customer's recent orders, newest first */
export const GET = route(async () => {
  const customer = await requireCustomer();
  // Catch up open orders with Banxa, but don't let a slow Banxa hold up the list: the rest finishes after the response.
  const refresh = refreshCustomerOrders(customer.id);
  after(refresh);
  await Promise.race([refresh, new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS))]);
  return NextResponse.json(listCustomerOrders(customer.id));
});

const bodySchema = z.object({
  /** Generated once per review screen; retries with the same key return the same order. */
  idempotencyKey: z.string().regex(/^[a-f0-9]{16}$/),
  quoteId: z.string().min(1).max(100).optional(),
  draft: z.unknown(),
});

/** POST /api/orders { draft, idempotencyKey, quoteId? } → order with its payment session */
export const POST = route(async (req) => {
  const customer = await requireCustomer();
  const body = bodySchema.parse(await readJson(req));
  const order = await createOrder(customer, await parseDraft(body.draft), body.idempotencyKey, body.quoteId);
  return NextResponse.json(toOrderView(order), { status: 201 });
});
