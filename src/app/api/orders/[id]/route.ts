import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { findOrder, toOrderView } from "@/modules/order/orders";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/orders/:id */
export const GET = route<Ctx>(async (_req, { params }) => {
  const customer = await requireCustomer();
  const order = findOrder((await params).id);
  if (!order || order.customerId !== customer.id) throw new HttpError(404, "Order not found");
  return NextResponse.json(toOrderView(order));
});
