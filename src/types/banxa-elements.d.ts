import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** JSX typings for the custom elements registered by @banxa-official/javascript-native-payments-sdk/web. */

type ElementProps<A> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & A;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "banxa-primer-checkout": ElementProps<{
        "client-token"?: string;
        locale?: string;
        "payment-methods"?: string;
        "merchant-domain"?: string;
        "layout-mode"?: "preset" | "auto" | "custom";
        "custom-styles"?: string;
      }>;
      "banxa-hosted-checkout": ElementProps<{
        "checkout-url"?: string;
        "return-url"?: string;
        "custom-styles"?: string;
      }>;
    }
  }
}
