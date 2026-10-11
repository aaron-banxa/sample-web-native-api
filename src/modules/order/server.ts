import "server-only";
import { SUPPORTED_METHODS } from "@/config/onramp";
import { banxa, isMock } from "@/lib/banxa";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { PaymentSession } from "@/lib/types";
import { assertAvailableInCountry, checkEligibility } from "@/modules/eligibility/server";
import type { Customer } from "@/modules/identity/customers";
import { claimLockedQuote } from "@/modules/quote/server";
import { amountOf, type ValidDraft } from "./draft";
import { findOrder, insertOrder, type Order } from "./orders";

/**
 * Step 5 · Order
 *
 *   Card / Apple Pay / Google Pay → Partner API v2 order. Its nativeToken drives
 *                                   <banxa-primer-checkout>; if Banxa says the order isn't
 *                                   paymentReady, use its checkoutUrl (hosted checkout) instead.
 *   Bank transfer (PayID, SEPA,   → Native API v0 ramp with deposit instructions, created from a
 *   Interac)                        locked quote when the customer has one. If the identity still
 *                                   needs checks the app can't collect, fall back to a v2
 *                                   hosted-checkout order, which runs them.
 *
 * `idempotencyKey` comes from the review screen and becomes our order id (Banxa's externalOrderId),
 * so a retry, double click or lost response returns the same order instead of creating another.
 * Webhooks that arrive before the order is saved get a 404 and are retried by Banxa.
 */
export async function createOrder(customer: Customer, draft: ValidDraft, idempotencyKey: string, quoteId?: string): Promise<Order> {
  const id = `ord-${idempotencyKey}`;
  const existing = findOrder(id);
  if (existing) {
    if (existing.customerId !== customer.id) throw new HttpError(409, "Please refresh and try again.");
    return existing;
  }
  const method = SUPPORTED_METHODS[draft.method];
  await assertAvailableInCountry(customer, draft);

  const common = {
    id,
    customerId: customer.id,
    method: draft.method,
    status: "AWAITING_PAYMENT" as const,
    fiat: draft.fiat,
    crypto: draft.crypto,
    blockchain: draft.blockchain,
    walletAddress: draft.walletAddress,
  };

  if (method.rail === "ramp") {
    const eligibility = await checkEligibility(customer, draft);
    if (eligibility.paymentReady) {
      const ramp = await banxa.createRamp(
        quoteId
          ? { quoteId: claimLockedQuote(customer, draft, quoteId), identityReference: customer.id, walletAddress: draft.walletAddress }
          : {
              identityReference: customer.id,
              fiat: draft.fiat,
              method: draft.method,
              crypto: draft.crypto,
              blockchain: draft.blockchain,
              walletAddress: draft.walletAddress,
              ...amountOf(draft),
            },
      );
      return saveOrder({
        ...common,
        rail: "ramp",
        banxaOrderId: ramp.banxaOrderId,
        fiatAmount: ramp.fiatAmount ?? draft.fiatAmount,
        cryptoAmount: ramp.cryptoAmount ?? null,
        payment: { mode: "bank", instructions: ramp.instructions },
      });
    }
    if (eligibility.next === "due-diligence") throw new HttpError(409, "Banxa needs a few more details before this order.");
    // Otherwise continue below with a hosted-checkout order.
  }

  const redirectUrl = `${env.APP_URL}/?order=${id}`;
  const order = await banxa.createNativeOrder({
    externalCustomerId: customer.id,
    externalOrderId: id,
    email: customer.email,
    fiat: draft.fiat,
    crypto: draft.crypto,
    blockchain: draft.blockchain,
    walletAddress: draft.walletAddress,
    paymentMethodId: draft.method,
    redirectUrl,
    ...amountOf(draft),
  });

  return saveOrder({
    ...common,
    rail: "native",
    banxaOrderId: order.banxaOrderId,
    fiatAmount: order.fiatAmount ?? draft.fiatAmount,
    cryptoAmount: order.cryptoAmount ?? null,
    payment: paymentSessionFor(order.paymentReady, order.nativeToken, order.checkoutUrl),
  });
}

/** Two simultaneous confirmations with the same key: the second one returns the order the first saved. */
function saveOrder(order: Parameters<typeof insertOrder>[0]): Order {
  try {
    return insertOrder(order);
  } catch (err) {
    const existing = findOrder(order.id);
    if (existing) return existing;
    throw err;
  }
}

function paymentSessionFor(paymentReady: boolean, nativeToken?: string, checkoutUrl?: string): PaymentSession {
  if (isMock) return paymentReady ? { mode: "mock-native" } : { mode: "mock-hosted" };
  if (paymentReady && nativeToken) return { mode: "native", nativeToken };
  if (checkoutUrl) return { mode: "hosted", checkoutUrl };
  throw new Error("Banxa returned neither a nativeToken nor a checkoutUrl");
}
