import { z } from "zod";

import {
  completeEmbeddedSignupJefe1,
  parseEmbeddedSignupSessionInfo,
  toEmbeddedSignupPublicResponse,
  validateWhatsAppSetupToken,
} from "@/lib/metaEmbeddedSignup";

export const runtime = "nodejs";

const EmbeddedSignupBodySchema = z.object({
  code: z.string().min(1),
  sessionInfo: z.record(z.string(), z.unknown()).optional(),
});

function mapErrorToStatus(message: string): number {
  if (message === "META_OAUTH_NOT_CONFIGURED") return 500;
  if (message.startsWith("META_TOKEN_EXCHANGE_FAILED")) return 502;
  if (message === "MISSING_PHONE_NUMBER_ID") return 400;
  if (message.startsWith("SUPABASE_")) return 500;
  return 500;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const setupToken = req.headers.get("x-whatsapp-setup-token");
    if (!validateWhatsAppSetupToken(setupToken)) {
      return Response.json({ error: "No autorizado" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const parsed = EmbeddedSignupBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "Body inválido" }, { status: 400 });
    }

    const sessionInfo = parseEmbeddedSignupSessionInfo(parsed.data.sessionInfo);

    const account = await completeEmbeddedSignupJefe1({
      code: parsed.data.code,
      sessionInfo,
    });

    console.log("[embedded-signup] Cuenta jefe_1 guardada:", {
      owner: account.owner,
      phone_number_id: account.phone_number_id,
      status: account.status,
      waba_id: account.waba_id,
    });

    return Response.json(toEmbeddedSignupPublicResponse(account), { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[embedded-signup] Error:", message);
    return Response.json(
      { error: "No se pudo completar el onboarding" },
      { status: mapErrorToStatus(message) },
    );
  }
}
