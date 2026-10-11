import { HttpError, route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { watchOrder } from "@/modules/fulfilment/watch";
import { findOrder, toOrderView } from "@/modules/order/orders";
import type { OrderView } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const HEARTBEAT_MS = 15_000;

/**
 * GET /api/orders/:id/events – Server-Sent Events stream of order updates.
 * Sends the current order immediately, then every change pushed by the webhook handler.
 * Outside mock mode the order is also polled on Banxa (once per order, shared by all its streams).
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const customer = await requireCustomer();
  const order = findOrder(id);
  if (!order || order.customerId !== customer.id) throw new HttpError(404, "Order not found");

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (view: OrderView) => write(`data: ${JSON.stringify(view)}\n\n`);

      send(toOrderView(order));
      const unwatch = watchOrder(id, send);
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

      cleanup = () => {
        unwatch();
        clearInterval(heartbeat);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
});
