"use client";

import { ArrowClockwiseIcon, InfoIcon, LockSimpleIcon } from "@/components/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { SUPPORTED_METHODS } from "@/config/onramp";
import { api, isAbort } from "@/lib/api";
import { formatFiat, shortAddress } from "@/lib/format";
import type { LockedQuoteView, OrderDraft, OrderView, QuoteView } from "@/lib/types";
import { useCatalog, useRunMode } from "@/components/onramp/onramp-context";
import { Button, Callout, Spinner } from "@/components/ui/primitives";
import { findMethod, findNetwork } from "@/modules/catalog/lookup";
import { loadPaymentSdk } from "@/modules/payment/payment-sdk";

interface Props {
  draft: OrderDraft;
  quote: QuoteView | null;
  verificationAtCheckout: boolean;
  onOrder: (order: OrderView) => void;
}

/**
 * Step 5 · Confirm and create the order.
 * Bank transfers lock the rate for ~3 minutes (GET /eapi/v0/quote) and order with that quoteId.
 * Other methods re-price just before confirming, since indicative prices aren't locked.
 */
export function ReviewStep({ draft, quote: initialQuote, verificationAtCheckout, onOrder }: Props) {
  const catalog = useCatalog();
  const { mock } = useRunMode();
  const rail = SUPPORTED_METHODS[draft.method].rail;
  const lockable = rail === "ramp" && !verificationAtCheckout;
  const methodName = findMethod(catalog, draft.fiat, draft.method)?.name ?? draft.method;
  const networkName = findNetwork(catalog, draft.crypto, draft.blockchain)?.name ?? draft.blockchain;
  const money = (v: string) => formatFiat(v, draft.fiat);

  const [quote, setQuote] = useState<QuoteView | null>(lockable ? null : initialQuote);
  const [locked, setLocked] = useState<LockedQuoteView | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per review screen: retrying the same confirmation can't create a second order.
  const [idempotencyKey] = useState(() => crypto.randomUUID().replace(/-/g, "").slice(0, 16));

  const lock = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      setLocked(null);
      try {
        const q = await api.lockQuote(draft, signal);
        setLocked(q);
        setQuote(q);
      } catch (err) {
        if (!isAbort(err)) setError(err instanceof Error ? err.message : "Couldn't lock a rate");
      }
    },
    [draft],
  );

  useEffect(() => {
    const controller = new AbortController();
    if (lockable) void lock(controller.signal);
    else api.quote(draft, controller.signal).then(setQuote, () => {});
    return () => controller.abort();
  }, [draft, lockable, lock]);

  // Card and wallet payments open the payment SDK next: start downloading it now.
  useEffect(() => {
    if (rail === "native" && !verificationAtCheckout && !mock) void loadPaymentSdk().catch(() => {});
  }, [rail, verificationAtCheckout, mock]);

  useEffect(() => {
    if (!locked) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((Date.parse(locked.expiresAt) - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [locked]);

  const expired = !!locked && secondsLeft === 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onOrder(await api.createOrder(draft, idempotencyKey, locked && !expired ? locked.quoteId : undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  const byCrypto = draft.amountType === "crypto";
  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <>
      <h2 className="step-title serif blur-in">Review your order</h2>
      <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>Check everything before you pay.</p>

      {lockable && (
        <div className={`lock${expired ? " expired" : ""}`} role="status">
          {!locked && !error ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Spinner dark small /> Locking your rate…</span>
          ) : expired ? (
            <span>Your locked rate expired.</span>
          ) : locked ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <LockSimpleIcon size={13} weight="fill" /> Rate locked for <span className="mono">{mmss}</span>
            </span>
          ) : (
            <span>Couldn&apos;t lock a rate.</span>
          )}
          {(expired || (error && !locked)) && (
            <button type="button" className="btn btn-sm" onClick={() => void lock()}>
              <ArrowClockwiseIcon size={13} weight="bold" /> Refresh rate
            </button>
          )}
        </div>
      )}

      <dl className="kv blur-in" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="kv-row"><dt>You pay{byCrypto && !locked ? " (estimate)" : ""}</dt><dd>{quote ? money(quote.fiatAmount) : byCrypto ? "—" : money(draft.fiatAmount)}</dd></div>
        <div className="kv-row"><dt>Processing fee</dt><dd>{quote ? money(quote.processingFee) : "—"}</dd></div>
        <div className="kv-row"><dt>Network fee</dt><dd>{quote ? money(quote.networkFee) : "—"}</dd></div>
        <div className="kv-row total">
          <dt>You receive{!byCrypto && !locked ? " (estimate)" : ""}</dt>
          <dd>{quote ? `${quote.cryptoAmount} ${draft.crypto}` : byCrypto ? `${draft.cryptoAmount} ${draft.crypto}` : "—"}</dd>
        </div>
      </dl>
      <dl className="kv blur-in" style={{ "--i": 3 } as React.CSSProperties}>
        <div className="kv-row"><dt>Network</dt><dd>{networkName}</dd></div>
        <div className="kv-row"><dt>Wallet</dt><dd className="mono" style={{ fontSize: 12 }} title={draft.walletAddress}>{shortAddress(draft.walletAddress)}</dd></div>
        <div className="kv-row"><dt>Pay with</dt><dd>{methodName}</dd></div>
      </dl>

      {verificationAtCheckout && <Callout tone="neutral">Banxa will ask you to verify your identity before you pay.</Callout>}
      <Callout tone="yellow">Crypto sent to the wrong address or network can&apos;t be recovered. Check the wallet before you continue.</Callout>
      {error && <Callout tone="red">{error}</Callout>}

      <Button
        variant="primary"
        block
        busy={busy}
        busyLabel="Creating order"
        disabled={lockable && (!locked || expired)}
        onClick={confirm}
        className="blur-in"
        style={{ "--i": 5 } as React.CSSProperties}
      >
        {lockable ? `Get ${methodName} details` : "Continue to payment"}
      </Button>
      <p className="hint" style={{ justifyContent: "center", marginTop: 10, textAlign: "center" }}>
        <InfoIcon size={13} />
        {lockable ? "Locked rates last about 3 minutes. Confirm before the timer runs out." : "The final amount is confirmed when you pay."}
      </p>
    </>
  );
}
