import type { EligibilityNext } from "@/lib/types";

/**
 * Which screen collects each Banxa `kycRequirement`.
 *
 *   NAME, DOB                                    sent automatically from the details the customer gave
 *   ADDRESS, OCCUPATION, SOURCE_FUNDS,
 *   PURPOSE_OF_TX, TIN                           due-diligence form in this app
 *   DOCUMENT, SELFIE, POA                        verification: reuse a Sumsub verification, or Banxa hosted checkout
 */
export const AUTO_REQUIREMENTS = ["NAME", "DOB"] as const;
export const DUE_DILIGENCE_REQUIREMENTS = ["ADDRESS", "OCCUPATION", "SOURCE_FUNDS", "PURPOSE_OF_TX", "TIN"] as const;

export type DueDiligenceRequirement = (typeof DUE_DILIGENCE_REQUIREMENTS)[number];

export const isDueDiligence = (r: string): r is DueDiligenceRequirement => (DUE_DILIGENCE_REQUIREMENTS as readonly string[]).includes(r);

export function nextStepFor(paymentReady: boolean, requirements: string[]): EligibilityNext {
  if (paymentReady) return "order";
  if (requirements.length > 0 && requirements.every(isDueDiligence)) return "due-diligence";
  return "verification";
}
