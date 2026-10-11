import "server-only";
import { banxa } from "@/lib/banxa";
import { IdentityUpdatesUnavailable, type Eligibility } from "@/lib/banxa/gateway";
import { HttpError } from "@/lib/http";
import type { EligibilityView } from "@/lib/types";
import { findCountry, findNetwork } from "@/modules/catalog/lookup";
import { getCatalog } from "@/modules/catalog/server";
import type { Customer } from "@/modules/identity/customers";
import { kycSharingEnabled } from "@/modules/identity/kyc-sharing";
import { amountOf, type ValidDraft } from "@/modules/order/draft";
import { AUTO_REQUIREMENTS, nextStepFor } from "./requirements";

/**
 * Step 3 · Eligibility
 * Ask Banxa whether this customer can make this specific purchase.
 * Gate on `paymentReady` only; `requirements` says what is still missing.
 */
export async function checkEligibility(customer: Customer, draft: ValidDraft): Promise<EligibilityView> {
  await assertAvailableInCountry(customer, draft);
  let result = await askBanxa(customer, draft);

  // NAME / DOB: we already have them, so send them instead of asking the customer again.
  if (identityUpdates.available && result.requirements.some((r) => (AUTO_REQUIREMENTS as readonly string[]).includes(r))) {
    try {
      await banxa.updateIdentity({
        identityReference: customer.id,
        email: customer.email,
        customerIdentity: { givenName: customer.givenName, surname: customer.surname, dob: customer.dateOfBirth },
      });
      result = await askBanxa(customer, draft);
    } catch (err) {
      if (!(err instanceof IdentityUpdatesUnavailable)) throw err;
      identityUpdates.available = false;
    }
  }

  return {
    paymentReady: result.paymentReady,
    requirements: result.requirements,
    // Without identity updates, nothing can be collected in-app: Banxa hosted checkout does it all.
    next: identityUpdates.available ? nextStepFor(result.paymentReady, result.requirements) : result.paymentReady ? "order" : "verification",
    kycSharing: kycSharingEnabled(),
  };
}

function askBanxa(customer: Customer, draft: ValidDraft): Promise<Eligibility> {
  return banxa.checkEligibility({
    identityReference: customer.id,
    fiat: draft.fiat,
    crypto: draft.crypto,
    blockchain: draft.blockchain,
    paymentMethodId: draft.method,
    ...amountOf(draft),
  });
}

/**
 * Whether this Banxa account accepts PATCH /identities. Assumed yes until Banxa says otherwise (error 4005),
 * then remembered for the life of the process.
 */
export const identityUpdates = ((globalThis as { __identityUpdates?: { available: boolean } }).__identityUpdates ??= { available: true });

/** Banxa lists countries where each network can't be used (GET /eapi/v0/cryptocurrencies). */
export async function assertAvailableInCountry(customer: Customer, draft: ValidDraft) {
  const catalog = await getCatalog();
  const network = findNetwork(catalog, draft.crypto, draft.blockchain);
  if (network?.unsupportedCountries.includes(customer.country)) {
    const country = findCountry(catalog, customer.country)?.name ?? customer.country;
    throw new HttpError(422, `${draft.crypto} on ${network.name} isn't available in ${country}. Choose another network or asset.`);
  }
}
