import "server-only";
import { z } from "zod";
import { banxa } from "@/lib/banxa";
import { IdentityUpdatesUnavailable } from "@/lib/banxa/gateway";
import { ValidationError } from "@/lib/http";
import type { EligibilityView } from "@/lib/types";
import { findCountry } from "@/modules/catalog/lookup";
import { getCatalog } from "@/modules/catalog/server";
import { checkEligibility, identityUpdates } from "@/modules/eligibility/server";
import type { Customer } from "@/modules/identity/customers";
import type { ValidDraft } from "@/modules/order/draft";
import { OCCUPATION_INDUSTRIES, OCCUPATIONS_BY_INDUSTRY, PURPOSES, SOURCES_OF_FUNDS, TAX_ID_TYPES } from "./options";

/**
 * Step 4 · Enhanced due diligence
 * Send only what eligibility asked for (PATCH /eapi/v0/identities), then re-check.
 * Never assume the update cleared everything.
 */

const addressSchema = z.object({
  addressLine: z.string().trim().min(1).max(200),
  suburb: z.string().trim().min(1).max(100),
  state: z.string().trim().min(2).max(3),
  postCode: z.string().trim().min(3).max(10),
  country: z.string().regex(/^[A-Z]{2}$/),
});

export const dueDiligenceSchema = z
  .object({
    occupationIndustry: z.enum(OCCUPATION_INDUSTRIES).optional(),
    occupation: z.string().min(1).optional(),
    sourceOfFunds: z.enum(SOURCES_OF_FUNDS).optional(),
    purposeOfTransaction: z.enum(PURPOSES).optional(),
    taxIdType: z.enum(TAX_ID_TYPES.map((t) => t.value) as [string, ...string[]]).optional(),
    taxId: z.string().trim().min(4).max(30).optional(),
    residentialAddress: addressSchema.optional(),
  })
  .superRefine((a, ctx) => {
    // Banxa rejects an occupation that doesn't belong to the chosen industry.
    if (a.occupation && (!a.occupationIndustry || !OCCUPATIONS_BY_INDUSTRY[a.occupationIndustry].includes(a.occupation))) {
      ctx.addIssue({ code: "custom", path: ["occupation"], message: "Choose an occupation from the selected industry" });
    }
    if (!!a.taxId !== !!a.taxIdType) ctx.addIssue({ code: "custom", path: ["taxId"], message: "Enter both the ID type and number" });
  });

export async function submitDueDiligence(customer: Customer, answers: z.infer<typeof dueDiligenceSchema>, draft: ValidDraft): Promise<EligibilityView> {
  const { taxIdType, taxId, residentialAddress, ...rest } = answers;

  if (residentialAddress) {
    // The address must be in the customer's country of residence, with a state Banxa recognises where it lists states.
    const country = findCountry(await getCatalog(), customer.country);
    if (residentialAddress.country !== customer.country) {
      throw new ValidationError([{ path: "residentialAddress.country", message: "Address must be in your country of residence" }]);
    }
    if (country?.states.length && !country.states.some((s) => s.code === residentialAddress.state)) {
      throw new ValidationError([{ path: "residentialAddress.state", message: "Select your state" }]);
    }
  }

  const customerIdentity = {
    ...(taxId ? { taxIdType, taxId } : {}),
    ...(residentialAddress ? { residentialAddress } : {}),
  };
  try {
    await banxa.updateIdentity({
      identityReference: customer.id,
      email: customer.email,
      ...rest,
      ...(Object.keys(customerIdentity).length ? { customerIdentity } : {}),
    });
  } catch (err) {
    // This Banxa account can't take identity updates: the re-check below routes to hosted checkout.
    if (!(err instanceof IdentityUpdatesUnavailable)) throw err;
    identityUpdates.available = false;
  }
  return checkEligibility(customer, draft);
}
