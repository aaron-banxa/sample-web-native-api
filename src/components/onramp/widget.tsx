"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftIcon, LockSimpleIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/primitives";
import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import { api } from "@/lib/api";
import type { CustomerView, EligibilityView, OrderDraft, OrderView, QuoteView } from "@/lib/types";
import { defaultDraft } from "@/modules/catalog/lookup";
import { isFailure, STATUS_LABEL } from "@/modules/fulfilment/status";
import { useOrderStream } from "@/modules/fulfilment/use-order-stream";
import { QuoteStep } from "@/modules/quote/quote-step";
import { useCatalog, useRunMode } from "./onramp-context";
import { markPaid, resumeStepFor } from "./paid-orders";

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

// The quote step ships with the page. Later steps load on demand, and are prefetched once the page is idle.
const loading = () => <div className="center" style={{ padding: 48 }}><Spinner dark /></div>;
const IdentityStep = dynamic(() => import("@/modules/identity/identity-step").then((m) => m.IdentityStep), { loading });
const EligibilityStep = dynamic(() => import("@/modules/eligibility/eligibility-step").then((m) => m.EligibilityStep), { loading });
const DueDiligenceStep = dynamic(() => import("@/modules/due-diligence/due-diligence-step").then((m) => m.DueDiligenceStep), { loading });
const ReviewStep = dynamic(() => import("@/modules/order/review-step").then((m) => m.ReviewStep), { loading });
const PaymentStep = dynamic(() => import("@/modules/payment/payment-step").then((m) => m.PaymentStep), { loading });
const DeliveryStep = dynamic(() => import("@/modules/fulfilment/delivery-step").then((m) => m.DeliveryStep), { loading });
const OrdersStep = dynamic(() => import("@/modules/order/orders-step").then((m) => m.OrdersStep), { loading });

function prefetchSteps() {
  void import("@/modules/identity/identity-step");
  void import("@/modules/eligibility/eligibility-step");
  void import("@/modules/due-diligence/due-diligence-step");
  void import("@/modules/order/review-step");
  void import("@/modules/payment/payment-step");
  void import("@/modules/fulfilment/delivery-step");
  void import("@/modules/order/orders-step");
}

/** Only move to delivery from the payment step, so a webhook and the payment sheet can't both add it. */
const toDelivery = (h: StepId[]): StepId[] => (h[h.length - 1] === "payment" ? [...h, "delivery"] : h);

interface Props {
  /** The remembered customer, read from the session cookie on the server. */
  initialCustomer: CustomerView | null;
  /** The order in the URL (`/?order=…`): a refresh, or the customer returning from Banxa hosted checkout. */
  initialOrder: OrderView | null;
  initialStep: "quote" | "payment" | "delivery";
}

export function OnrampWidget({ initialCustomer, initialOrder, initialStep }: Props) {
  const catalog = useCatalog();
  const { mock } = useRunMode();
  const [history, setHistory] = useState<StepId[]>(initialStep === "quote" ? ["quote"] : ["quote", initialStep]);
  const [draft, setDraft] = useState<OrderDraft>(() => defaultDraft(catalog, mock)!);
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [customer, setCustomer] = useState(initialCustomer);
  const [eligibility, setEligibility] = useState<EligibilityView | null>(null);
  const [order, setOrder] = useState(initialOrder);

  const step = history[history.length - 1];
  const go = (next: StepId) => setHistory((h) => [...h, next]);
  const back = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));

  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(prefetchSteps, { timeout: 4000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(prefetchSteps, 2000);
    return () => clearTimeout(id);
  }, []);

  // One live connection for the open order, shared by the payment and delivery steps.
  const onOrderUpdate = useCallback((next: OrderView) => {
    setOrder(next);
    // Banxa has seen the payment (for example, a bank transfer arrived): show delivery.
    if (next.status !== "AWAITING_PAYMENT") setHistory(toDelivery);
  }, []);
  useOrderStream(step === "payment" || step === "delivery" ? order : null, onOrderUpdate);

  /** Open an order from the order history. */
  const openOrder = useCallback(async (orderId: string) => {
    const o = await api.order(orderId);
    setOrder(o);
    window.history.replaceState(null, "", `/?order=${o.id}`);
    setHistory(["quote", "orders", resumeStepFor(o)]);
  }, []);

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

  // The payment sheet authorised the payment. Delivery waits for Banxa to confirm it.
  const orderId = order?.id;
  const onPaid = useCallback(() => {
    if (orderId) markPaid(orderId);
    setHistory(toDelivery);
  }, [orderId]);

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
          {step === "quote" && (
            <QuoteStep
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
          {step === "payment" && order && <PaymentStep order={order} onPaid={onPaid} onRestart={restart} />}
          {step === "delivery" && order && <DeliveryStep order={order} onRestart={restart} />}
          {step === "orders" && <OrdersStep onOpen={(id) => void openOrder(id)} />}
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
