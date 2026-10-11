"use client";

import { ShieldCheckIcon } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import { Callout, Spinner } from "@/components/ui/primitives";

interface Props {
  nativeToken: string;
  /** Primer method type, e.g. PAYMENT_CARD, APPLE_PAY, GOOGLE_PAY. */
  primerMethod: string;
  merchantDomain?: string;
  onAuthorised: () => void;
}

/**
 * Card / Apple Pay / Google Pay through `<banxa-primer-checkout>` (JS Native Payments SDK).
 * Primer captures card numbers and wallet tokens in its own iframes; they never touch this app.
 *
 * `banxa:payment-success` means the payment was authorised. The order is only complete
 * once Banxa says so via webhook, which the delivery step listens for.
 */
export function NativeCheckout({ nativeToken, primerMethod, merchantDomain, onAuthorised }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The SDK touches `window`, so load it in the browser only.
  useEffect(() => {
    import("@banxa-official/javascript-native-payments-sdk/web")
      .then(({ registerBanxaPrimerCheckout }) => {
        registerBanxaPrimerCheckout();
        setRegistered(true);
      })
      .catch(() => setError("Couldn't load the payment form. Refresh and try again."));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!registered || !el) return;
    const onSuccess = () => onAuthorised();
    const onFailure = () => setError("Your payment didn't go through. Check your details or try another method.");
    const onStart = () => setError(null);
    const onLoadError = () => setError("Couldn't load the payment form. Refresh and try again.");
    el.addEventListener("banxa:payment-success", onSuccess);
    el.addEventListener("banxa:payment-failure", onFailure);
    el.addEventListener("banxa:payment-start", onStart);
    el.addEventListener("checkout-error", onLoadError);
    return () => {
      el.removeEventListener("banxa:payment-success", onSuccess);
      el.removeEventListener("banxa:payment-failure", onFailure);
      el.removeEventListener("banxa:payment-start", onStart);
      el.removeEventListener("checkout-error", onLoadError);
    };
  }, [registered, onAuthorised]);

  return (
    <>
      <div className="sheet">
        <div className="sheet-label">
          <span>Secure payment</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldCheckIcon size={12} weight="fill" /> Secured by Primer</span>
        </div>
        <div className="native-host">
          {registered ? (
            <banxa-primer-checkout ref={ref} client-token={nativeToken} payment-methods={primerMethod} merchant-domain={merchantDomain || undefined} locale="en" />
          ) : (
            <div className="center" style={{ padding: 32 }}><Spinner dark /></div>
          )}
        </div>
      </div>
      {error && <Callout tone="red" className="pop" >{error}</Callout>}
    </>
  );
}
