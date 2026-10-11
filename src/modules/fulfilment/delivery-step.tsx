"use client";

import { ArrowSquareOutIcon, CheckIcon, CircleIcon } from "@/components/ui/icons";
import { cryptoMeta, NETWORK_META } from "@/config/onramp";
import { shortAddress } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import { useCatalog } from "@/components/onramp/onramp-context";
import { Button, Callout, CopyButton, LocalTime, Spinner } from "@/components/ui/primitives";
import { findNetwork } from "@/modules/catalog/lookup";
import { isFailure, progressOf, type AppStatus } from "./status";

interface Props {
  /** Kept live by the widget (useOrderStream). */
  order: OrderView;
  onRestart: () => void;
}

const RING = 2 * Math.PI * 58;

/** When a stage was reached: the first time this app saw that status or a later one. */
function reachedAt(order: OrderView, stage: number): string | undefined {
  const first = Object.entries(order.statusTimes)
    .filter(([status]) => progressOf(status as AppStatus) >= stage)
    .map(([, at]) => at)
    .sort()[0];
  return first ?? (stage === 0 ? order.createdAt : undefined);
}

/** Step 7 · Follow the order to delivery. Every update here comes from a Banxa webhook. */
export function DeliveryStep({ order, onRestart }: Props) {
  const catalog = useCatalog();
  const networkName = findNetwork(catalog, order.crypto, order.blockchain)?.name ?? order.blockchain;
  const explorerTxUrl = NETWORK_META[order.blockchain]?.explorerTxUrl;
  const decimals = Math.min(cryptoMeta(order.crypto).decimals, 6);

  const stages = [
    { title: "Order created", sub: "Waiting for payment", at: 0 },
    { title: "Payment received", sub: "Funds confirmed by Banxa", at: 1 },
    { title: "Processing", sub: `Buying ${order.crypto}`, at: 2 },
    { title: "Crypto sent", sub: `Sent on ${networkName}`, at: 4 },
    { title: "Complete", sub: "Delivered to your wallet", at: 5 },
  ];

  const failed = isFailure(order.status);
  const progress = progressOf(order.status);
  const doneCount = stages.filter((s) => progress >= s.at).length;

  const complete = order.status === "COMPLETE";
  const title = complete
    ? "Delivered"
    : failed
      ? order.status === "FAILED" ? "Payment failed" : order.status === "EXPIRED" ? "Order expired" : "Order cancelled"
      : order.status === "NEEDS_VERIFICATION"
        ? "Action needed"
        : order.status === "REFUNDED"
          ? "Refunded"
          : order.status === "AWAITING_PAYMENT"
            ? "Waiting for payment"
            : "Sending your crypto";

  return (
    <>
      <div className="ring-wrap blur-in">
        <svg className="ring" viewBox="0 0 132 132" aria-hidden="true">
          <circle className="track" cx="66" cy="66" r="58" />
          <circle className="bar" cx="66" cy="66" r="58" strokeDasharray={RING} strokeDashoffset={RING * (1 - doneCount / stages.length)} style={failed ? { stroke: "var(--red)" } : undefined} />
        </svg>
        <div className="ring-center">
          <span className="big">{order.cryptoAmount ? Number(order.cryptoAmount).toLocaleString("en-AU", { minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals }) : "—"}</span>
          <span className="muted" style={{ fontSize: 12 }}>{order.crypto}</span>
        </div>
      </div>
      <h2 className="step-title serif center blur-in" style={{ "--i": 1 } as React.CSSProperties}>{title}</h2>
      <p className="step-sub center blur-in" style={{ "--i": 2 } as React.CSSProperties}>
        To <span className="mono" style={{ fontSize: 12 }}>{shortAddress(order.walletAddress)}</span> on {networkName}
      </p>

      <ol className="timeline">
        {stages.map((s, i) => {
          const done = progress >= s.at;
          const now = !done && !failed && i === doneCount;
          return (
            <li key={s.title} className={done ? "done" : now ? "now" : "pending"}>
              <span className="t-dot">{done ? <CheckIcon size={11} weight="bold" /> : now ? <Spinner dark small /> : <CircleIcon size={6} weight="fill" />}</span>
              <div>
                <div className="t-title">{s.title}</div>
                <div className="t-sub">{s.sub}</div>
              </div>
              <span className="t-time">{done && <LocalTime iso={reachedAt(order, s.at)} />}</span>
            </li>
          );
        })}
      </ol>

      {failed && (
        <>
          <Callout tone="red">This order didn&apos;t complete. If you were charged, Banxa will refund you automatically.</Callout>
          <Button variant="primary" block onClick={onRestart}>Start again</Button>
        </>
      )}
      {order.status === "NEEDS_VERIFICATION" && (
        <Callout tone="yellow">Banxa needs more information to finish this order and will contact you by email.</Callout>
      )}

      {complete && (
        <div className="pop">
          {order.txHash && (
            <div className="kv">
              <div className="copy-row">
                <div><div className="k">Transaction hash</div><div className="hash">{order.txHash}</div></div>
                <CopyButton value={order.txHash} label="transaction hash" />
              </div>
            </div>
          )}
          <div className="row">
            {order.txHash && explorerTxUrl ? (
              <a className="btn" href={explorerTxUrl + order.txHash} target="_blank" rel="noreferrer">
                <ArrowSquareOutIcon size={16} weight="bold" /> View transaction
              </a>
            ) : (
              <span />
            )}
            <Button variant="primary" onClick={onRestart}>Buy again</Button>
          </div>
        </div>
      )}
    </>
  );
}
