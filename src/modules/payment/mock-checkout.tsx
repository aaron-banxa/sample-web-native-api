"use client";

import { AppleLogoIcon, CheckCircleIcon, CreditCardIcon, IdentificationCardIcon, ScanSmileyIcon } from "@/components/ui/icons";
import { useState } from "react";
import { SUPPORTED_METHODS, type MethodId } from "@/config/onramp";
import { Button, Callout } from "@/components/ui/primitives";

/**
 * Mock-mode stand-ins for `<banxa-primer-checkout>` and `<banxa-hosted-checkout>`.
 * They look and behave like the real sheets but call /api/mock/payment instead of charging anyone.
 *
 * Test card that is declined: 4000 0000 0000 0002
 */

const DECLINE_CARD = "4000000000000002";

interface Props {
  method: MethodId;
  /** Formatted, e.g. "A$250.00". */
  amount: string;
  onPay: () => Promise<void>;
}

export function MockNativeCheckout({ method, amount, onPay }: Props) {
  const kind = SUPPORTED_METHODS[method].kind;
  const [card, setCard] = useState("4111 1111 1111 1111");
  const [showCard, setShowCard] = useState(kind === "card");
  const [wallet, setWallet] = useState<"apple" | "google" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setError(null);
    if (card.replace(/\s/g, "") === DECLINE_CARD) {
      setError("Your bank declined this payment. No money was taken. Try another card or payment method.");
      return;
    }
    setBusy(true);
    try {
      await onPay();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="sheet">
        <div className="sheet-label">
          <span>Secure payment</span>
          <span className="tag yellow">mock</span>
        </div>

        {kind === "apple" && (
          <button type="button" className="wallet-btn apple" onClick={() => setWallet("apple")}>
            <AppleLogoIcon size={18} weight="fill" /> Pay
          </button>
        )}
        {kind === "google" && (
          <button type="button" className="wallet-btn google" onClick={() => setWallet("google")}>
            <GoogleMark /> Pay
          </button>
        )}
        {kind !== "card" && <div className="divider">or pay by card</div>}

        {showCard ? (
          <>
            <div className="field hosted-field">
              <label className="label" htmlFor="card">Card number</label>
              <input id="card" className="input mono" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value)} />
              <div className="card-brands"><span style={{ color: "#1a1f71" }}>VISA</span><span style={{ color: "#eb001b" }}>MC</span><span style={{ color: "#2e77bc" }}>AMEX</span></div>
            </div>
            <div className="row">
              <div className="field"><label className="label" htmlFor="exp">Expiry</label><input id="exp" className="input mono" defaultValue="03 / 30" /></div>
              <div className="field"><label className="label" htmlFor="cvc">Security code</label><input id="cvc" className="input mono" defaultValue="737" /></div>
            </div>
            <Button variant="primary" block busy={busy} busyLabel="Processing" onClick={pay}>Pay {amount}</Button>
            <p className="hint" style={{ justifyContent: "center", marginTop: 8 }}>Use 4000 0000 0000 0002 to test a decline.</p>
          </>
        ) : (
          <Button block onClick={() => setShowCard(true)}><CreditCardIcon size={16} weight="bold" /> Use a card instead</Button>
        )}
      </div>

      {error && <Callout tone="red" className="pop">{error}</Callout>}
      {wallet && (
        <WalletSheet
          kind={wallet}
          amount={amount}
          onCancel={() => setWallet(null)}
          onConfirm={async () => {
            await pay();
            setWallet(null);
          }}
        />
      )}
    </>
  );
}

function WalletSheet({ kind, amount, onCancel, onConfirm }: { kind: "apple" | "google"; amount: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const confirm = () => {
    setConfirming(true);
    setTimeout(() => void onConfirm(), 900);
  };
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="os-sheet" role="dialog" aria-label={kind === "apple" ? "Apple Pay" : "Google Pay"} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <strong style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 4 }}>
            {kind === "apple" ? <><AppleLogoIcon size={18} weight="fill" />Pay</> : "Google Pay"}
          </strong>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        </div>
        <div className="os-row"><span className="muted">Card</span><span>Visa •••• 4242</span></div>
        <div className="os-row"><span className="muted">Pay</span><span>BANXA</span></div>
        <div className="os-row" style={{ fontWeight: 600 }}><span>Total</span><span>{amount}</span></div>
        <div className="os-confirm">
          {confirming ? (
            <><CheckCircleIcon size={40} weight="fill" color="#34a853" /><span>Done</span></>
          ) : kind === "apple" ? (
            <button type="button" className="btn btn-ghost" onClick={confirm} style={{ flexDirection: "column", height: "auto", padding: 8 }}>
              <ScanSmileyIcon size={44} color="#1a73e8" />
              <span>Confirm with Face ID</span>
            </button>
          ) : (
            <Button variant="primary" block style={{ background: "#1a73e8", borderColor: "#1a73e8" }} onClick={confirm}>Continue</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Mock of Banxa hosted checkout, which verifies identity and takes payment. */
export function MockHostedCheckout({ amount, onPay }: { amount: string; onPay: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="sheet">
      <div className="sheet-label">
        <span>Banxa checkout</span>
        <span className="tag yellow">mock</span>
      </div>
      <div className="center" style={{ padding: "12px 0 16px" }}>
        <IdentificationCardIcon size={40} color="var(--muted)" />
        <p className="step-sub" style={{ margin: "8px 0 0" }}>In sandbox and production, Banxa&apos;s hosted checkout loads here to check your ID, then takes payment.</p>
      </div>
      <Button
        variant="primary"
        block
        busy={busy}
        busyLabel="Processing"
        onClick={async () => {
          setBusy(true);
          await onPay().catch(() => setBusy(false));
        }}
      >
        Verify ID and pay {amount}
      </Button>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.2z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.8-.7-4.3s.3-3 .7-4.3V14H4.5C3 17 2 20.4 2 24s1 7 2.5 10l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
    </svg>
  );
}
