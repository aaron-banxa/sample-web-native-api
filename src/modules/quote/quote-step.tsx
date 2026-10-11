"use client";

import { AppleLogoIcon, ArrowDownIcon, BankIcon, CheckCircleIcon, ClockIcon, CreditCardIcon, GoogleLogoIcon, ListIcon, PencilSimpleIcon, WarningCircleIcon } from "@/components/ui/icons";
import { useEffect, useState } from "react";
import { cryptoMeta, NETWORK_META, SUPPORTED_METHODS, type MethodId } from "@/config/onramp";
import { api } from "@/lib/api";
import { formatFiat } from "@/lib/format";
import type { CustomerView, LimitsView, OrderDraft, QuoteView } from "@/lib/types";
import { useCatalog } from "@/components/onramp/catalog-context";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Button, CoinIcon } from "@/components/ui/primitives";
import { draftIssues, findFiat, findNetwork, isValidWallet } from "@/modules/catalog/lookup";
import { useWalletSupport } from "@/modules/payment/wallet-support";

const REFRESH_SECONDS = 15;

const METHOD_ICON: Record<(typeof SUPPORTED_METHODS)[MethodId]["kind"], React.ReactNode> = {
  card: <span className="method-icon"><CreditCardIcon size={15} weight="bold" /></span>,
  apple: <span className="method-icon dark"><AppleLogoIcon size={15} weight="fill" /></span>,
  google: <span className="method-icon"><GoogleLogoIcon size={15} weight="bold" /></span>,
  bank: <span className="method-icon"><BankIcon size={15} weight="bold" /></span>,
};

const sanitize = (v: string, decimals: number) => v.replace(/[^0-9.]/g, "").replace(new RegExp(`(\\.\\d{0,${decimals}}).*`), "$1");

interface Props {
  mock: boolean;
  draft: OrderDraft;
  onDraftChange: (draft: OrderDraft) => void;
  quote: QuoteView | null;
  onQuote: (quote: QuoteView | null) => void;
  customer: CustomerView | null;
  onForgetCustomer: () => void;
  onShowOrders: () => void;
  onContinue: () => void;
}

/**
 * Step 1 · Amount (in fiat or crypto), currency, asset, wallet and payment method, with a live indicative price.
 * Options and limits come from Banxa's configuration endpoints (via the catalog), and the customer's
 * own limits (POST /eapi/v0/identities/transactions/limits) once we know who they are.
 */
export function QuoteStep({ mock, draft, onDraftChange, quote, onQuote, customer, onForgetCustomer, onShowOrders, onContinue }: Props) {
  const catalog = useCatalog();
  const [loading, setLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [limits, setLimits] = useState<LimitsView | null>(null);
  const [seconds, setSeconds] = useState(REFRESH_SECONDS);
  const [refreshTick, setRefreshTick] = useState(0);
  const wallets = useWalletSupport(mock);

  const fiat = findFiat(catalog, draft.fiat)!;
  const network = findNetwork(catalog, draft.crypto, draft.blockchain)!;
  const issues = draftIssues(catalog, draft);
  const walletValid = isValidWallet(network, draft.walletAddress);
  const decimals = Math.min(cryptoMeta(draft.crypto).decimals, 6);
  const byCrypto = draft.amountType === "crypto";

  // The customer's own headroom: the lowest of their per-order max and remaining period allowances.
  const fiatEstimate = byCrypto ? Number(quote?.fiatAmount ?? 0) : Number(draft.fiatAmount);
  const caps = limits ? [limits.maximum, ...limits.remaining.map((r) => r.amount)].filter((v): v is number => v !== null) : [];
  const limitCap = caps.length ? Math.min(...caps) : null;
  const overLimit = limitCap !== null && fiatEstimate > limitCap;
  const underLimit = limits?.minimum != null && fiatEstimate > 0 && fiatEstimate < limits.minimum;

  const amountError =
    issues.find((i) => i.path === (byCrypto ? "cryptoAmount" : "fiatAmount"))?.message ??
    (overLimit ? `Your current limit is ${formatFiat(limitCap!, fiat.code)}` : null) ??
    (underLimit ? `The minimum for your account is ${formatFiat(limits!.minimum!, fiat.code)}` : null);

  const set = (patch: Partial<OrderDraft>) => onDraftChange({ ...draft, ...patch });

  // Only the amount the customer typed drives pricing; the other side is the estimate.
  const amountKey = byCrypto ? `c:${draft.cryptoAmount}` : `f:${draft.fiatAmount}`;
  const priceable = !issues.some((i) => i.path === "fiatAmount" || i.path === "cryptoAmount" || i.path === "method" || i.path === "blockchain");

  // Indicative price (GET /api/quote → GET /eapi/v0/price): debounced on input, refreshed every 15s.
  useEffect(() => {
    if (!priceable) {
      onQuote(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .quote(draft, controller.signal)
        .then((q) => {
          onQuote(q);
          setQuoteError(null);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setQuoteError(err.message);
        })
        .finally(() => setLoading(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Only price inputs re-quote; typing a wallet address doesn't.
  }, [draft.fiat, amountKey, draft.crypto, draft.blockchain, draft.method, priceable, refreshTick, onQuote]);

  // Customer limits for this currency, method and asset.
  useEffect(() => {
    if (!customer) return setLimits(null);
    const controller = new AbortController();
    api.limits(draft, controller.signal).then(setLimits, () => setLimits(null));
    return () => controller.abort();
  }, [customer, draft.fiat, draft.method, draft.crypto, draft.blockchain]);

  useEffect(() => {
    let remaining = REFRESH_SECONDS;
    const id = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = REFRESH_SECONDS;
        setRefreshTick((t) => t + 1);
      }
      setSeconds(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const changeFiat = (code: string) => {
    const next = findFiat(catalog, code)!;
    const method = next.methods.find((m) => m.id === draft.method) ?? next.methods[0];
    set({ fiat: code, method: method.id });
  };

  const changeAsset = (value: string) => {
    const [code, net] = value.split(":");
    const nextNetwork = findNetwork(catalog, code, net)!;
    const keepWallet = isValidWallet(nextNetwork, draft.walletAddress);
    set({ crypto: code, blockchain: net, walletAddress: keepWallet ? draft.walletAddress : mock ? (NETWORK_META[net]?.testWallet ?? "") : "" });
  };

  /** Switch which side the customer types, seeding it with the current estimate. */
  const editFiat = () => set({ amountType: "fiat", fiatAmount: quote ? String(Number(quote.fiatAmount)) : draft.fiatAmount });
  const editCrypto = () => set({ amountType: "crypto", cryptoAmount: quote ? String(Number(quote.cryptoAmount)) : draft.cryptoAmount });

  const canContinue = issues.length === 0 && !overLimit && !underLimit && !!quote && !quoteError;
  const today = limits?.remaining.find((r) => r.period === "DAILY");
  // Headroom today: the lowest of the daily allowance, the customer's per-order max and the method's max.
  const methodMax = fiat.methods.find((m) => m.id === draft.method)?.maximum ?? Infinity;
  const todayCap = today ? Math.min(today.amount, limits?.maximum ?? Infinity, methodMax) : null;

  return (
    <>
      <h2 className="step-title serif blur-in">Buy crypto</h2>
      <p className="step-sub blur-in" style={{ "--i": 1 } as React.CSSProperties}>
        Delivered straight to your own wallet.
      </p>

      <div className="blur-in" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="amount-box top">
          <label className="amount-label" htmlFor="amount">You pay{byCrypto ? " (estimate)" : ""}</label>
          <div className="amount-row">
            {byCrypto ? (
              <button type="button" className="amount-value amount-switch" onClick={editFiat} aria-label="Enter the amount to pay instead">
                {quote ? <NumberTicker value={Number(quote.fiatAmount)} /> : "—"} <PencilSimpleIcon size={14} className="faint" />
              </button>
            ) : (
              <input
                id="amount"
                className="amount-input"
                inputMode="decimal"
                autoComplete="off"
                value={draft.fiatAmount}
                onChange={(e) => set({ fiatAmount: sanitize(e.target.value, 2) })}
                aria-invalid={!!amountError}
              />
            )}
            <span className={`asset-chip${catalog.fiats.length > 1 ? " selectable" : ""}`}>
              <span className="coin" style={{ background: "#1f3a68" }}>{fiat.symbol}</span>
              {fiat.code}
              {catalog.fiats.length > 1 && (
                <select aria-label="Currency" value={fiat.code} onChange={(e) => changeFiat(e.target.value)}>
                  {catalog.fiats.map((f) => <option key={f.code} value={f.code}>{f.code} · {f.name}</option>)}
                </select>
              )}
            </span>
          </div>
        </div>
        <div className="swap-dot"><span><ArrowDownIcon size={14} weight="bold" /></span></div>
        <div className="amount-box bottom">
          <label className="amount-label" htmlFor="receive">You receive{byCrypto ? "" : " (estimate)"}</label>
          <div className="amount-row">
            {byCrypto ? (
              <input
                id="receive"
                className="amount-input"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={draft.cryptoAmount}
                onChange={(e) => set({ cryptoAmount: sanitize(e.target.value, cryptoMeta(draft.crypto).decimals) })}
                aria-invalid={!!amountError}
              />
            ) : (
              <button type="button" className={`amount-value amount-switch${loading && !quote ? " loading" : ""}`} onClick={editCrypto} aria-label={`Enter the amount of ${draft.crypto} to receive instead`}>
                {quote ? <NumberTicker value={Number(quote.cryptoAmount)} decimals={decimals} /> : "—"} <PencilSimpleIcon size={14} className="faint" />
              </button>
            )}
            <span className="asset-chip selectable">
              <CoinIcon code={draft.crypto} />
              {draft.crypto} <small>{draft.blockchain}</small>
              <select aria-label="Asset and network" value={`${draft.crypto}:${draft.blockchain}`} onChange={(e) => changeAsset(e.target.value)}>
                {catalog.cryptos.map((c) => (
                  <optgroup key={c.code} label={c.name}>
                    {c.networks.map((n) => (
                      <option key={`${c.code}:${n.id}`} value={`${c.code}:${n.id}`}>{c.code} · {n.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </span>
          </div>
        </div>
        {(amountError || quoteError) && (
          <p className="hint err" style={{ marginTop: 8 }}>
            <WarningCircleIcon size={14} weight="fill" /> {amountError ?? quoteError}
          </p>
        )}
        {!amountError && !quoteError && todayCap !== null && (
          <p className="hint" style={{ marginTop: 8 }}>
            You can buy up to {formatFiat(todayCap, fiat.code)} {todayCap === methodMax ? "per order" : "today"}
          </p>
        )}
      </div>

      <div className="field blur-in" style={{ "--i": 3, marginTop: 16 } as React.CSSProperties}>
        <label className="label" htmlFor="wallet">Your {network.name} wallet address</label>
        <input
          id="wallet"
          className="input mono"
          spellCheck={false}
          autoComplete="off"
          value={draft.walletAddress}
          onChange={(e) => set({ walletAddress: e.target.value.trim() })}
          aria-invalid={!!draft.walletAddress && !walletValid}
        />
        {draft.walletAddress ? (
          <p className={`hint ${walletValid ? "ok" : "err"}`}>
            {walletValid ? <CheckCircleIcon size={14} weight="fill" /> : <WarningCircleIcon size={14} weight="fill" />}
            {walletValid ? `Valid ${network.name} address` : `Not a valid ${network.name} address`}
          </p>
        ) : (
          mock && NETWORK_META[network.id]?.testWallet && (
            <p className="hint">
              Mock mode:{" "}
              <button type="button" className="link" onClick={() => set({ walletAddress: NETWORK_META[network.id]!.testWallet! })}>use a test wallet</button>
            </p>
          )
        )}
      </div>

      <div className="blur-in" style={{ "--i": 4 } as React.CSSProperties}>
        <div className="label">Pay with</div>
        <div className="methods" role="radiogroup" aria-label="Payment method">
          {fiat.methods.map((m) => {
            const ui = SUPPORTED_METHODS[m.id];
            const unavailable = (ui.kind === "apple" && !wallets.apple) || (ui.kind === "google" && !wallets.google);
            const selected = draft.method === m.id;
            return (
              <button key={m.id} type="button" className="method" role="radio" aria-checked={selected} disabled={unavailable} onClick={() => set({ method: m.id })}>
                {METHOD_ICON[ui.kind]}
                <span>
                  <span className="method-name">{m.name}</span>
                  <br />
                  <span className="method-meta">{unavailable ? "Not available in this browser" : ui.meta}</span>
                </span>
                <span className="method-fee">{selected && quote ? `${formatFiat(quote.processingFee, fiat.code)} fee` : null}</span>
              </button>
            );
          })}
        </div>
      </div>

      {quote && (
        <details className="details blur-in" style={{ "--i": 5 } as React.CSSProperties}>
          <summary>
            <span>Rate and fees</span>
            <span className="mono">{quote.rate ? `1 ${draft.crypto} ≈ ${formatFiat(quote.rate, fiat.code)}` : formatFiat(Number(quote.processingFee) + Number(quote.networkFee), fiat.code)}</span>
          </summary>
          <dl className="kv">
            <div className="kv-row"><dt>Processing fee</dt><dd>{formatFiat(quote.processingFee, fiat.code)}</dd></div>
            <div className="kv-row"><dt>Network fee</dt><dd>{formatFiat(quote.networkFee, fiat.code)}</dd></div>
            <div className="kv-row total"><dt>Total</dt><dd>{formatFiat(quote.fiatAmount, fiat.code)}</dd></div>
          </dl>
        </details>
      )}

      <Button variant="primary" block disabled={!canContinue} onClick={onContinue} className="blur-in" style={{ "--i": 6 } as React.CSSProperties}>
        Continue
      </Button>
      <p className="hint blur-in" style={{ "--i": 7, justifyContent: "center", marginTop: 10 } as React.CSSProperties}>
        <ClockIcon size={13} /> Indicative price · refreshes in <span className="mono">{seconds}</span>s
      </p>
      {customer && (
        <p className="hint" style={{ justifyContent: "center", marginTop: 6, flexWrap: "wrap" }}>
          <button type="button" className="link" onClick={onShowOrders} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ListIcon size={13} /> Your orders
          </button>
          · {customer.email} ·{" "}
          <button type="button" className="link" onClick={onForgetCustomer}>Not you?</button>
        </p>
      )}
    </>
  );
}
