"use client";

import { ArrowSquareOutIcon, IdentificationCardIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";

interface Props {
  checkoutUrl: string;
}

/**
 * Banxa hosted checkout, used when Banxa says the order isn't paymentReady for the native sheet
 * (usually because the customer must upload ID and take a selfie first).
 *
 * We redirect the whole page rather than embedding `<banxa-hosted-checkout>`: ID and selfie checks
 * need the camera, which browsers block inside cross-origin iframes. Banxa sends the customer back
 * to the order's redirectUrl (/?order=…), where the delivery step shows live status from webhooks.
 */
export function HostedCheckout({ checkoutUrl }: Props) {
  return (
    <div className="sheet">
      <div className="center" style={{ padding: "12px 0 16px" }}>
        <IdentificationCardIcon size={40} color="var(--muted)" />
        <p className="step-sub" style={{ margin: "8px 0 0" }}>
          You&apos;ll continue on Banxa to verify your ID and pay, then come straight back here.
        </p>
      </div>
      <Button variant="primary" block onClick={() => window.location.assign(checkoutUrl)}>
        Continue to Banxa <ArrowSquareOutIcon size={16} weight="bold" />
      </Button>
    </div>
  );
}
