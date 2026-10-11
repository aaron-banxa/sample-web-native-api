import { HttpError, route } from "@/lib/http";
import { requireCustomer } from "@/lib/session";
import { watchOrder } from "@/modules/fulfilment/watch";
import { findOrder, toOrderView } from "@/modules/order/orders";
import type { OrderView } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const HEARTBEAT_MS = 15_000;
/** Streams are closed after this; EventSource reconnects by itself. Stops abandoned streams living forever. */
const MAX_STREAM_MS = 5 * 60_000;
/** Open streams allowed per customer (a few tabs). */
const MAX_STREAMS_PER_CUSTOMER = 5;
const openStreams: Map<string, number> = ((globalThis as { __openStreams?: Map<string, number> }).__openStreams ??= new Map());

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
  const open = openStreams.get(customer.id) ?? 0;
  if (open >= MAX_STREAMS_PER_CUSTOMER) throw new HttpError(429, "Too many open order pages. Close some tabs and try again.");
  openStreams.set(customer.id, open + 1);

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

      write("retry: 3000\n\n"); // reconnect delay after the stream is closed
      send(toOrderView(order));
      const unwatch = watchOrder(id, send);
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const close = () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      };
      const expiry = setTimeout(close, MAX_STREAM_MS);

      let closed = false;
      cleanup = () => {
        if (closed) return;
        closed = true;
        unwatch();
        clearInterval(heartbeat);
        clearTimeout(expiry);
        const left = (openStreams.get(customer.id) ?? 1) - 1;
        if (left > 0) openStreams.set(customer.id, left);
        else openStreams.delete(customer.id);
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
});
