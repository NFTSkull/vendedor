import type { NextRequest } from "next/server";

import { getMetaWebhookVerificationResponse } from "@/lib/metaWebhookVerification";

export async function GET(req: NextRequest): Promise<Response> {
  const verified = getMetaWebhookVerificationResponse(
    req.nextUrl.searchParams,
    process.env.WHATSAPP_VERIFY_TOKEN,
  );
  return verified ?? new Response("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = (await req.json()) as unknown;
  console.log("[WhatsApp webhook POST]", JSON.stringify(body, null, 2));
  return Response.json({}, { status: 200 });
}
