"use client";

import { ArrowLeftIcon, LockSimpleIcon } from "@/components/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { CustomerView, EligibilityView, OrderDraft, OrderView, QuoteView } from "@/lib/types";
import { Spinner } from "@/components/ui/primitives";
import { defaultDraft } from "@/modules/catalog/lookup";
import { useCatalog } from "./catalog-context";
import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import { DueDiligenceStep } from "@/modules/due-diligence/due-diligence-step";
import { EligibilityStep } from "@/modules/eligibility/eligibility-step";
import { DeliveryStep } from "@/modules/fulfilment/delivery-step";
import { isFailure, STATUS_LABEL } from "@/modules/fulfilment/status";
import { IdentityStep } from "@/modules/identity/identity-step";
import { OrdersStep } from "@/modules/order/orders-step";
import { ReviewStep } from "@/modules/order/review-step";
import { PaymentStep } from "@/modules/payment/payment-step";
import { QuoteStep } from "@/modules/quote/quote-step";

/**
 * The onramp flow:
 *   quote → identity → eligibility → (due diligence) → review → payment → delivery
 * Each step lives in src/modules/<step>. This component only holds state and routes between them.
 */

const STEPS = [
  { id: "quote", label: "Quote" },
  { id: "identity", label: "Identity" },
  { id: "eligibility", label: "Eligibility" },
  { id: "due-diligence", label: "Due diligence" },
  { id: "review", label: "Review" },
  { id: "payment", label: "Payment" },
  { id: "delivery", label: "Delivery" },
] as const;

/** "orders" is a side view (order history), not part of the purchase flow. */
type StepId = (typeof STEPS)[number]["id"] | "orders";

/** Orders the customer already paid for in this browser, so a refresh doesn't show the payment sheet again. */
const PAID_KEY = "onramp:paid-orders";
const markPaid = (id: string) => {
  try {
    const ids = new Set<string>(JSON.parse(sessionStorage.getItem(PAID_KEY) ?? "[]"));
    sessionStorage.setItem(PAID_KEY, JSON.stringify([...ids.add(id)]));
  } catch {}
};
const wasPaid = (id: string) => {
  try {
    return (JSON.parse(sessionStorage.getItem(PAID_KEY) ?? "[]") as string[]).includes(id);
  } catch {
    return false;
  }
};

interface Props {
  mode: "mock" | "sandbox" | "production";
  initialOrderId?: string;
  merchantDomain?: string;
}

export function OnrampWidget({ mode, initialOrderId, merchantDomain }: Props) {
  const mock = mode === "mock";
  const catalog = useCatalog();
  const [history, setHistory] = useState<StepId[]>(["quote"]);
  const [draft, setDraft] = useState<OrderDraft>(() => defaultDraft(catalog, mock)!);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [customer, setCustomer] = useState<CustomerView | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityView | null>(null);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [restoring, setRestoring] = useState(!!initialOrderId);

  const step = history[history.length - 1];
  const go = (next: StepId) => setHistory((h) => [...h, next]);
  const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));

  useEffect(() => {
    api.me().then(setCustomer, () => {});
  }, []);

  /** Show an existing order: the payment step if it still needs paying, otherwise delivery. */
  const openOrder = useCallback(async (orderId: string, base: StepId[]) => {
    const o = await api.order(orderId);
    setOrder(o);
    window.history.replaceState(null, "", `/?order=${o.id}`);
    const payNow = o.status === "AWAITING_PAYMENT" && o.payment.mode !== "hosted" && !wasPaid(o.id);
    setHistory([...base, payNow ? "payment" : "delivery"]);
  }, []);

  // Returning from Banxa hosted checkout (redirectUrl) or a page refresh: restore the order.
  useEffect(() => {
    if (!initialOrderId) return;
    openOrder(initialOrderId, ["quote"])
      .catch(() => window.history.replaceState(null, "", "/"))
      .finally(() => setRestoring(false));
  }, [initialOrderId, openOrder]);

  const routeEligibility = (result: EligibilityView) => {
    setEligibility(result);
    go(result.next === "due-diligence" ? "due-diligence" : "review");
  };

  const restart = useCallback(() => {
    setOrder(null);
    setEligibility(null);
    setHistory(["quote"]);
    window.history.replaceState(null, "", "/");
  }, []);

  const onPaid = useCallback(() => {
    setOrder((o) => {
      if (o) markPaid(o.id);
      return o;
    });
    setHistory((h) => [...h, "delivery"]);
  }, []);
  const onOrderUpdate = useCallback((o: OrderView) => setOrder(o), []);

  const pill = pillFor(step, { draft, customer, eligibility, order });
  const index = STEPS.findIndex((s) => s.id === step);
  const canGoBack = history.length > 1 && step !== "payment" && (step !== "delivery" || history.includes("orders"));

  return (
    <>
      <StatusPill text={pill.text} meta={pill.meta} tone={pill.tone} />
      <div className="widget">
        <div className="beam" aria-hidden="true" />
        <div className="widget-head">
          <span className="step-eyebrow">{step === "orders" ? "Order history" : `Step ${index + 1} of ${STEPS.length} · ${STEPS[index].label}`}</span>
          {canGoBack && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={back}>
              <ArrowLeftIcon size={14} weight="bold" /> Back
            </button>
          )}
        </div>
        <div className="widget-progress" aria-hidden="true">
          {STEPS.map((s, i) => <span key={s.id} className={step !== "orders" && i <= index ? "on" : ""} />)}
        </div>

        <div className="widget-body" key={step}>
          {restoring ? (
            <div className="center" style={{ padding: 48 }}><Spinner dark /></div>
          ) : (
            <>
              {step === "quote" && (
                <QuoteStep
                  mock={mock}
                  draft={draft}
                  onDraftChange={setDraft}
                  quote={quote}
                  onQuote={setQuote}
                  customer={customer}
                  onForgetCustomer={() => api.forget().then(() => setCustomer(null))}
                  onShowOrders={() => go("orders")}
                  onContinue={() => go(customer ? "eligibility" : "identity")}
                />
              )}
              {step === "identity" && (
                <IdentityStep
                  mock={mock}
                  onDone={(c) => {
                    setCustomer(c);
                    go("eligibility");
                  }}
                />
              )}
              {step === "eligibility" && customer && <EligibilityStep draft={draft} customer={customer} onContinue={routeEligibility} />}
              {step === "due-diligence" && eligibility && (
                <DueDiligenceStep
                  requirements={eligibility.requirements}
                  draft={draft}
                  country={customer?.country ?? ""}
                  onResult={(result) => {
                    setEligibility(result);
                    if (result.next !== "due-diligence") go("review");
                  }}
                />
              )}
              {step === "review" && (
                <ReviewStep
                  draft={draft}
                  quote={quote}
                  verificationAtCheckout={eligibility?.next === "verification"}
                  onOrder={(o) => {
                    setOrder(o);
                    window.history.replaceState(null, "", `/?order=${o.id}`);
                    go("payment");
                  }}
                />
              )}
              {step === "payment" && order && <PaymentStep order={order} mock={mock} merchantDomain={merchantDomain} onPaid={onPaid} onRestart={restart} />}
              {step === "delivery" && order && <DeliveryStep order={order} onUpdate={onOrderUpdate} onRestart={restart} />}
              {step === "orders" && <OrdersStep onOpen={(id) => void openOrder(id, ["quote", "orders"])} />}
            </>
          )}
        </div>

        <div className="widget-foot">
          <LockSimpleIcon size={12} weight="fill" /> Crypto services provided by <strong style={{ color: "var(--muted)", fontWeight: 500 }}>Banxa</strong>
        </div>
      </div>
    </>
  );
}

function pillFor(
  step: StepId,
  s: { draft: OrderDraft; customer: CustomerView | null; eligibility: EligibilityView | null; order: OrderView | null },
): { text: string; meta?: string; tone?: PillTone } {
  if ((step === "payment" || step === "delivery") && s.order) {
    const tone: PillTone = isFailure(s.order.status) ? "red" : s.order.status === "NEEDS_VERIFICATION" ? "amber" : "ok";
    return { text: STATUS_LABEL[s.order.status], meta: s.order.id, tone };
  }
  switch (step) {
    case "orders":
      return { text: "Order history", meta: s.customer?.email };
    case "quote":
      return { text: "Live price", meta: `${s.draft.fiat} → ${s.draft.crypto}` };
    case "identity":
      return { text: "Your details" };
    case "eligibility":
      return { text: "Checking eligibility", meta: s.customer?.email };
    case "due-diligence":
      return { text: "Details needed", meta: `${s.eligibility?.requirements.length ?? 0} items`, tone: "amber" };
    default:
      return s.eligibility?.paymentReady ? { text: "Payment ready" } : { text: "Review order" };
  }
}
