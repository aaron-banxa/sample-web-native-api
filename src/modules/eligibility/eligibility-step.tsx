"use client";

import { CheckIcon, ExclamationMarkIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatFiat } from "@/lib/format";
import type { CustomerView, EligibilityView, OrderDraft } from "@/lib/types";
import { useCatalog } from "@/components/onramp/catalog-context";
import { Button, Callout, Spinner } from "@/components/ui/primitives";
import { findMethod, findNetwork } from "@/modules/catalog/lookup";
import { VerificationOptions } from "./verification-options";

interface Props {
  draft: OrderDraft;
  customer: CustomerView;
  onContinue: (result: EligibilityView) => void;
}

/** "A$250.00", or "0.05 BTC" when the customer chose a crypto amount. */
const amountLabel = (d: OrderDraft) => (d.amountType === "crypto" ? `${d.cryptoAmount} ${d.crypto}` : formatFiat(d.fiatAmount, d.fiat));

/** Step 3 · Ask Banxa whether this customer can make this purchase. */
export function EligibilityStep({ draft, customer, onContinue }: Props) {
  const catalog = useCatalog();
  const [result, setResult] = useState<EligibilityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (started.current === attempt) return; // React StrictMode runs effects twice in development
    started.current = attempt;
    setError(null);
    api.eligibility(draft).then(setResult, (err: Error) => setError(err.message));
  }, [attempt, draft]);

  const rows: [string, string][] = [
    ["Identity on file", customer.email],
    ["Payment method", findMethod(catalog, draft.fiat, draft.method)?.name ?? draft.method],
    ["Wallet address", findNetwork(catalog, draft.crypto, draft.blockchain)?.name ?? draft.blockchain],
    ["Amount", amountLabel(draft)],
  ];

  const ready = result?.paymentReady;

  return (
    <>
      <h2 className="step-title serif blur-in">Checking your order</h2>
      <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>This usually takes a few seconds.</p>

      <ul className="checklist">
        {rows.map(([label, value], i) => (
          <li key={label} className="pop" style={{ animationDelay: `${i * 90}ms` }}>
            <span className={`state ${result ? "ok" : "wait"}`}>{result ? <CheckIcon size={12} weight="bold" /> : <Spinner dark small />}</span>
            <span>{label}</span>
            <span className="val">{value}</span>
          </li>
        ))}
        <li className="pop" style={{ animationDelay: "360ms" }}>
          <span className={`state ${!result ? "wait" : ready ? "ok" : "warn"}`}>
            {!result ? <Spinner dark small /> : ready ? <CheckIcon size={12} weight="bold" /> : <ExclamationMarkIcon size={12} weight="bold" />}
          </span>
          <span>Compliance checks</span>
          <span className="val">{!result ? "checking" : ready ? "clear" : `${result.requirements.length} needed`}</span>
        </li>
      </ul>

      {error && (
        <>
          <Callout tone="red">{error}</Callout>
          <Button block onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
        </>
      )}

      {result?.next === "order" && (
        <div className="pop">
          <Callout tone="green"><strong>You&apos;re ready to pay.</strong><br />No more information needed for this order.</Callout>
          <Button variant="primary" block onClick={() => onContinue(result)}>Review order</Button>
        </div>
      )}

      {result?.next === "due-diligence" && (
        <div className="pop">
          <Callout tone="yellow">
            <strong>We need a few more details.</strong>
            <br />Required for this order under anti-money-laundering rules.
            <div className="chips" style={{ marginTop: 8 }}>
              {result.requirements.map((r) => <span key={r} className="req-chip">{r}</span>)}
            </div>
          </Callout>
          <Button variant="primary" block onClick={() => onContinue(result)}>Add details</Button>
        </div>
      )}

      {result?.next === "verification" && (
        <VerificationOptions
          result={result}
          draft={draft}
          onHostedCheckout={() => onContinue(result)}
          onRechecked={(next) => {
            setResult(next);
            if (next.next !== "verification") onContinue(next);
          }}
        />
      )}
    </>
  );
}
