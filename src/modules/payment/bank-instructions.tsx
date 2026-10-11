"use client";

import { FlaskIcon } from "@/components/ui/icons";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatFiat } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import { Button, Callout, CopyButton, Spinner } from "@/components/ui/primitives";
import { useOrderStream } from "@/modules/fulfilment/use-order-stream";

/**
 * Labels for deposit instruction fields across bank-transfer methods
 * (PayID, SEPA, Interac, ACH…). Unknown fields are still shown, with a generated label.
 */
const LABELS: Record<string, string> = {
  recipientEmail: "Send to (email)",
  recipientName: "Account name",
  recipientAddress: "Account address",
  IBAN: "IBAN",
  BIC: "BIC / SWIFT",
  bankName: "Bank",
  bankAddress: "Bank address",
  bankAccountNumber: "Account number",
  bankRoutingNumber: "Routing number",
  bankBeneficiaryName: "Beneficiary",
  bankBeneficiaryAddress: "Beneficiary address",
  paymentRail: "Payment rail",
  securityQuestion: "Security question",
  securityAnswer: "Security answer",
  depositReference: "Reference",
};

/** Fields the customer must enter exactly, or Banxa can't match the payment. */
const MUST_MATCH = new Set(["depositReference", "securityAnswer"]);
const HIDDEN = new Set(["currency", "amount"]);

const labelFor = (key: string) => LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

interface Props {
  order: OrderView;
  mock: boolean;
  onReceived: () => void;
}

/** Bank transfer: show the deposit instructions Banxa returned and wait for the payment webhook (→ SSE). */
export function BankInstructions({ order: initial, mock, onReceived }: Props) {
  const order = useOrderStream(initial);
  const [simulating, setSimulating] = useState(false);
  const instructions = order.payment.mode === "bank" ? order.payment.instructions : {};
  const fields = Object.entries(instructions).filter(([k]) => !HIDDEN.has(k));
  const mustMatch = fields.filter(([k]) => MUST_MATCH.has(k)).map(([k]) => labelFor(k).toLowerCase());

  useEffect(() => {
    if (order.status !== "AWAITING_PAYMENT") onReceived();
  }, [order.status, onReceived]);

  return (
    <>
      <div className="kv blur-in" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="copy-row">
          <div><div className="k">Amount</div><div className="v">{formatFiat(order.fiatAmount, order.fiat)}</div></div>
          <CopyButton value={order.fiatAmount} label="amount" />
        </div>
        {fields.map(([key, value]) => (
          <div key={key} className={`copy-row${MUST_MATCH.has(key) ? " must" : ""}`}>
            <div>
              <div className="k">{labelFor(key)}{MUST_MATCH.has(key) ? " (required)" : ""}</div>
              <div className="v">{value}</div>
            </div>
            <CopyButton value={value} label={labelFor(key)} />
          </div>
        ))}
      </div>

      {mustMatch.length > 0 && (
        <Callout tone="yellow">Include the {mustMatch.join(" and ")} exactly as shown. Without it, Banxa can&apos;t match your payment.</Callout>
      )}

      <div className="waiting">
        <Spinner dark />
        <div>
          <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Waiting for your transfer</strong>
          <br />
          <span className="muted" style={{ fontSize: 12 }}>This page updates automatically.</span>
        </div>
      </div>

      {mock && (
        <Button
          block
          busy={simulating}
          busyLabel="Waiting for Banxa"
          onClick={() => {
            setSimulating(true);
            api.mockPay(order.id).catch(() => setSimulating(false));
          }}
        >
          <FlaskIcon size={16} weight="bold" /> Simulate bank transfer
        </Button>
      )}
    </>
  );
}
