import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { syncOrders } from "@/modules/order/sync";

/**
 * POST /api/sync – reconcile orders with Banxa. Call from a scheduler (cron) with
 *   Authorization: Bearer $SYNC_SECRET
 * Disabled unless SYNC_SECRET is set.
 */
export const POST = route(async (req) => {
  if (!env.SYNC_SECRET) throw new HttpError(404, "Not found");
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(env.SYNC_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, "Unauthorized");
  return NextResponse.json(await syncOrders());
});
