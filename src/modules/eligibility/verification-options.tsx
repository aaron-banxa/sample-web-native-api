"use client";

import { IdentificationCardIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { EligibilityView, OrderDraft } from "@/lib/types";
import { Button, Callout, Spinner } from "@/components/ui/primitives";

const POLL_MS = 4000;
const MAX_WAIT_MS = 3 * 60_000;

interface Props {
  result: EligibilityView;
  draft: OrderDraft;
  /** Continue with Banxa hosted checkout, which runs its own ID check. */
  onHostedCheckout: () => void;
  /** KYC sharing finished and eligibility was re-checked. */
  onRechecked: (result: EligibilityView) => void;
}

/**
 * Banxa needs documents or a selfie. Two ways to provide them:
 *   1. Reuse a verification the customer already passed in your Sumsub account (KYC token sharing).
 *   2. Banxa hosted checkout, which verifies identity before taking payment.
 */
export function VerificationOptions({ result, draft, onHostedCheckout, onRechecked }: Props) {
  const [state, setState] = useState<"idle" | "sharing" | "waiting" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function share() {
    setState("sharing");
    setMessage(null);
    try {
      await api.shareKyc();
      setState("waiting");
      poll(Date.now());
    } catch (err) {
      setState("failed");
      setMessage(err instanceof Error ? err.message : "We couldn't reuse your verification.");
    }
  }

  // Banxa verifies shared tokens asynchronously: wait for VERIFIED, then use the re-checked eligibility.
  function poll(startedAt: number) {
    timer.current = setTimeout(async () => {
      try {
        const { kycStatus, eligibility } = await api.kycStatus(draft);
        if (eligibility) return onRechecked(eligibility);
        if (kycStatus === "REJECTED" || kycStatus === "ACTION_REQUIRED") {
          setState("failed");
          return setMessage("Banxa couldn't verify your existing profile. Verify with Banxa instead.");
        }
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          setState("failed");
          return setMessage("Verification is taking longer than usual. You can wait and try again, or verify with Banxa now.");
        }
        poll(startedAt);
      } catch (err) {
        setState("failed");
        setMessage(err instanceof Error ? err.message : "Something went wrong");
      }
    }, POLL_MS);
  }

  return (
    <div className="pop">
      <Callout tone="yellow">
        <strong>Banxa needs to verify your identity.</strong>
        <br />
        {result.requirements.filter((r) => ["DOCUMENT", "SELFIE", "POA"].includes(r)).length
          ? "A photo ID and a quick selfie are required for this order."
          : "A few more checks are required for this order."}
      </Callout>

      {state === "waiting" && (
        <div className="waiting">
          <Spinner dark />
          <div>
            <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Checking your existing verification</strong>
            <br />
            <span className="muted" style={{ fontSize: 12 }}>This can take a minute.</span>
          </div>
        </div>
      )}
      {message && <Callout tone="red">{message}</Callout>}

      {result.kycSharing && state !== "waiting" && (
        <Button variant="primary" block busy={state === "sharing"} busyLabel="Sharing" onClick={share} style={{ marginBottom: 8 }}>
          <IdentificationCardIcon size={16} weight="bold" /> Use my existing verification
        </Button>
      )}
      <Button variant={result.kycSharing ? "default" : "primary"} block onClick={onHostedCheckout} disabled={state === "sharing"}>
        Verify with Banxa at checkout
      </Button>
    </div>
  );
}
