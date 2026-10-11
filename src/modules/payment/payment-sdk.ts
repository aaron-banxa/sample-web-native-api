"use client";

type PaymentSdk = typeof import("@banxa-official/javascript-native-payments-sdk/web");

let sdk: Promise<PaymentSdk> | null = null;

/**
 * The JS Native Payments SDK (with Primer) is large and touches `window`, so it loads in the browser,
 * once, on demand. The review step calls this early so the payment form is ready when it's needed.
 */
export function loadPaymentSdk(): Promise<PaymentSdk> {
  sdk ??= import("@banxa-official/javascript-native-payments-sdk/web").catch((err) => {
    sdk = null; // let the next attempt retry
    throw err;
  });
  return sdk;
}
