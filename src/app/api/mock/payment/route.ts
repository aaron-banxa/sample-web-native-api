import { NextResponse } from "next/server";
import { z } from "zod";
import { isMock } from "@/lib/banxa";
import { simulatePayment } from "@/lib/banxa/mock-gateway";
import { HttpError, route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { findOrder } from "@/modules/order/orders";

/**
 * POST /api/mock/payment { orderId } – mock mode only.
 * Stands in for the customer paying (card, wallet, hosted checkout or bank transfer).
 * The mock then sends signed webhooks to /api/webhooks/banxa.
 */
export const POST = route(async (req) => {
  if (!isMock) throw new HttpError(404, "Not found");
  const customer = await requireCustomer();
  const { orderId } = z.object({ orderId: z.string() }).parse(await req.json());
  const order = findOrder(orderId);
  if (!order || order.customerId !== customer.id) throw new HttpError(404, "Order not found");

  simulatePayment(order.banxaOrderId, new URL(req.url).origin);
  return NextResponse.json({ ok: true });
});
