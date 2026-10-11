"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    ApplePaySession?: { canMakePayments(): boolean };
  }
}

/** Apple Pay on the web needs Safari with ApplePaySession and a domain registered with Banxa. */
export function supportsApplePay(): boolean {
  try {
    return !!window.ApplePaySession?.canMakePayments();
  } catch {
    return false;
  }
}

/** Google Pay works in Chrome and on Android only. */
export function supportsGooglePay(): boolean {
  const ua = navigator.userAgent;
  return /Android/.test(ua) || (/Chrome\//.test(ua) && !/Edg\/|OPR\//.test(ua));
}

/** Which wallets to offer. Mock mode offers both so every path can be tried. */
export function useWalletSupport(mock: boolean) {
  const [support, setSupport] = useState({ apple: mock, google: mock });
  useEffect(() => {
    if (!mock) setSupport({ apple: supportsApplePay(), google: supportsGooglePay() });
  }, [mock]);
  return support;
}
