"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { SUPPORTED_METHODS } from "@/config/onramp";
import { api } from "@/lib/api";
import { formatFiat } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import { BankInstructions } from "./bank-instructions";
import { HostedCheckout } from "./hosted-checkout";
import { NativeCheckout } from "./native-checkout";

// Mock checkouts load only when a mock order needs them.
const MockNativeCheckout = dynamic(() => import("./mock-checkout").then((m) => m.MockNativeCheckout));
const MockHostedCheckout = dynamic(() => import("./mock-checkout").then((m) => m.MockHostedCheckout));

interface Props {
  order: OrderView;
  /** The payment sheet authorised the payment. */
  onPaid: () => void;
  /** Abandon this order (e.g. the payment token expired) and start a new one. */
  onRestart: () => void;
}

/** Step 6 · Payment. The order's payment session decides which checkout to show. */
export function PaymentStep({ order, onPaid, onRestart }: Props) {
  const payment = order.payment;
  const mockPay = useCallback(async () => {
    await api.mockPay(order.id);
    onPaid();
  }, [order.id, onPaid]);

  const title = payment.mode === "bank" ? `Pay by ${SUPPORTED_METHODS[order.method].label}` : `Pay ${formatFiat(order.fiatAmount, order.fiat)}`;
  const subtitle =
    payment.mode === "bank"
      ? "Send exactly this amount from your banking app."
      : payment.mode === "hosted" || payment.mode === "mock-hosted"
        ? "Verify your identity with Banxa, then pay."
        : "Payments are processed securely by Banxa.";

  return (
    <>
      <h2 className="step-title serif blur-in">{title}</h2>
      <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>{subtitle}</p>

      {payment.mode === "native" && (
        <NativeCheckout nativeToken={payment.nativeToken} primerMethod={SUPPORTED_METHODS[order.method].primer ?? "PAYMENT_CARD"} onAuthorised={onPaid} />
      )}
      {payment.mode === "hosted" && <HostedCheckout checkoutUrl={payment.checkoutUrl} />}
      {payment.mode === "bank" && <BankInstructions order={order} />}
      {payment.mode === "mock-native" && <MockNativeCheckout method={order.method} amount={formatFiat(order.fiatAmount, order.fiat)} onPay={mockPay} />}
      {payment.mode === "mock-hosted" && <MockHostedCheckout amount={formatFiat(order.fiatAmount, order.fiat)} onPay={mockPay} />}
      {payment.mode !== "bank" && (
        <p className="hint" style={{ justifyContent: "center", marginTop: 12 }}>
          Payment not loading? <button type="button" className="link" onClick={onRestart}>Start a new order</button>
        </p>
      )}
    </>
  );
}
