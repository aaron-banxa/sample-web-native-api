"use client";

import { CheckIcon, CopyIcon, InfoIcon, SealCheckIcon, WarningIcon, XCircleIcon } from "@/components/ui/icons";
import { useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cryptoMeta } from "@/config/onramp";

export function Spinner({ dark, small }: { dark?: boolean; small?: boolean }) {
  return <span className={`spinner${dark ? " dark" : ""}${small ? " sm" : ""}`} aria-hidden="true" />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "default" | "ghost";
  block?: boolean;
  busy?: boolean;
  busyLabel?: string;
};

export function Button({ variant = "default", block, busy, busyLabel, className = "", children, disabled, ...rest }: ButtonProps) {
  const cls = ["btn", variant === "primary" && "btn-primary", variant === "ghost" && "btn-ghost", block && "btn-block", className].filter(Boolean).join(" ");
  return (
    <button className={cls} disabled={disabled || busy} {...rest}>
      {busy ? (
        <>
          <Spinner dark={variant !== "primary"} /> {busyLabel ?? "Please wait"}…
        </>
      ) : (
        children
      )}
    </button>
  );
}

const CALLOUT_ICON = { neutral: InfoIcon, yellow: WarningIcon, red: XCircleIcon, green: SealCheckIcon } as const;

export function Callout({ tone = "neutral", children, className = "" }: { tone?: keyof typeof CALLOUT_ICON; children: ReactNode; className?: string }) {
  const Icon = CALLOUT_ICON[tone];
  return (
    <div className={`callout ${tone} ${className}`} role={tone === "red" ? "alert" : undefined}>
      <Icon size={16} weight="fill" />
      <div>{children}</div>
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} weight="bold" />}
    </button>
  );
}

export function CoinIcon({ code }: { code: string }) {
  const meta = cryptoMeta(code);
  return (
    <span className="coin" style={{ background: meta.color }} aria-hidden="true">
      {meta.glyph}
    </span>
  );
}

const noSubscribe = () => () => {};
/** False during server rendering and hydration, true afterwards. For output that depends on the browser (time zone, locale). */
export const useIsClient = () => useSyncExternalStore(noSubscribe, () => true, () => false);

/** A time in the viewer's time zone. Rendered after hydration, since the server doesn't know the viewer's zone. */
export function LocalTime({ iso }: { iso?: string }) {
  const client = useIsClient();
  return <>{iso && client ? new Date(iso).toLocaleTimeString("en-AU", { hour12: false }) : ""}</>;
}
