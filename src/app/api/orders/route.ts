import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { parseDraft } from "@/modules/order/draft";
import { listCustomerOrders, toOrderView } from "@/modules/order/orders";
import { createOrder } from "@/modules/order/server";
import { refreshCustomerOrders } from "@/modules/order/sync";

/** GET /api/orders – the customer's recent orders, newest first */
export const GET = route(async () => {
  const customer = await requireCustomer();
  await refreshCustomerOrders(customer.id);
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
  const body = bodySchema.parse(await req.json());
  const order = await createOrder(customer, await parseDraft(body.draft), body.idempotencyKey, body.quoteId);
  return NextResponse.json(toOrderView(order), { status: 201 });
});
