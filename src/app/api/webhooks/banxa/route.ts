import { verifyWebhookSignature } from "@/lib/banxa/signing";
import { env } from "@/lib/env";
import { alreadyProcessed, applyBanxaUpdate, markProcessed, type BanxaIdentityWebhook, type BanxaRampWebhook } from "@/modules/fulfilment/server";
import { findCustomerById, markCustomerBlocked } from "@/modules/identity/customers";

/**
 * POST /api/webhooks/banxa
 *
 * 1. Verify the HMAC signature against the RAW body.
 * 2. Skip events already processed (Banxa retries until it gets a 200).
 * 3. Apply the event, then record it.
 * 4. Return 200 quickly. Slow follow-up work (emails, ledgers) belongs in `after()`.
 *
 * Handles ramp status messages (order_id) and identity messages (identity_reference).
 * Unknown orders get a 404 so Banxa retries once the order is saved.
 * Docs: https://docs.banxa.com/products/native-api/docs/transaction-lifecycle/webhooks
 */
export async function POST(req: Request) {
  const raw = await req.text();

  if (!verifyWebhookSignature(req.headers.get("authorization"), raw, env.BANXA_WEBHOOK_PATH, env.webhookSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: Partial<BanxaRampWebhook & BanxaIdentityWebhook>;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }

  try {
    // Identity messages may also carry an order_id, so check them first.
    if (event.identity_reference && event.status) {
      handleIdentityMessage(event as BanxaIdentityWebhook, raw);
    } else if (event.order_id && event.status) {
      if (!handleRampMessage(event as BanxaRampWebhook, raw)) {
        // Not ours yet (or not ours at all). Don't record it: a non-2xx makes Banxa retry.
        return new Response("unknown order", { status: 404 });
      }
    } else {
      // Unknown message type (e.g. KYC updates not enabled here). Acknowledge so Banxa doesn't retry.
      console.warn("[webhook] unhandled payload", raw.slice(0, 500));
    }
  } catch (err) {
    console.error("[webhook] failed to apply", err);
    return new Response("error", { status: 500 }); // Banxa will retry
  }

  return new Response("ok");
}

/** Returns false if the order isn't known locally. */
function handleRampMessage(event: BanxaRampWebhook, raw: string): boolean {
  const key = `${event.order_id}:${event.status}`;
  if (alreadyProcessed(key)) return true;
  const order = applyBanxaUpdate({
    banxaOrderId: event.order_id,
    externalOrderId: event.external_id,
    status: event.status,
    cryptoAmount: event.crypto_amount,
    transactionHash: event.transaction_hash,
  });
  if (!order) return false;
  markProcessed(key, event.order_id, event.status, raw);
  return true;
}

function handleIdentityMessage(event: BanxaIdentityWebhook, raw: string) {
  const key = `identity:${event.identity_reference}:${event.status}`;
  if (alreadyProcessed(key)) return;
  if (event.status === "ACCOUNT_BLOCKED" && findCustomerById(event.identity_reference)) {
    markCustomerBlocked(event.identity_reference);
  }
  markProcessed(key, event.identity_reference, event.status, raw);
}
