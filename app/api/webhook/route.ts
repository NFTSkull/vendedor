import type { NextRequest } from "next/server";

import { procesarYEvolucionar } from "@/lib/botSteps";
import {
  buscarLeadPorTelefono,
  guardarMensaje,
  leadEnModoChat,
} from "@/lib/messagesDb";
import { getMetaWebhookVerificationResponse } from "@/lib/metaWebhookVerification";
import { extraerTextosEntrantes } from "@/lib/parseWhatsAppWebhook";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const verified = getMetaWebhookVerificationResponse(
    req.nextUrl.searchParams,
    process.env.WHATSAPP_VERIFY_TOKEN,
  );
  return verified ?? new Response("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest): Promise<Response> {
  console.log(
    "[DEBUG] ANTHROPIC_API_KEY disponible:",
    Boolean(process.env.ANTHROPIC_API_KEY),
  );

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  console.log("[WEBHOOK_DEBUG] payload completo (Meta):", JSON.stringify(payload, null, 2));

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion =
    process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.GRAPH_API_VERSION;

  try {
    if (!accessToken || !phoneNumberId) {
      console.error(
        "Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID en el entorno",
      );
      return Response.json({}, { status: 200 });
    }

    const mensajes = extraerTextosEntrantes(payload);

    for (const m of mensajes) {
      console.log("[WEBHOOK_DEBUG] from extraído (parseWhatsAppWebhook):", m.from);

      let leadChat = null;
      try {
        leadChat = await buscarLeadPorTelefono(m.from);
        if (leadChat && leadEnModoChat(leadChat.estado)) {
          await guardarMensaje({
            leadId: leadChat.id,
            direccion: "entrante",
            contenido: m.body,
          });
        }
      } catch (err) {
        console.error("[webhook] Error guardando mensaje entrante:", err);
      }

      if (leadChat?.estado === "contactado") {
        continue;
      }

      const reply = await procesarYEvolucionar({
        phone: m.from,
        textoUsuario: m.body,
      });
      if (!reply) continue;

      console.log("[WEBHOOK_DEBUG] to usado en Graph (enviarMensajeTextoWa):", m.from);

      const envio = await enviarMensajeTextoWa({
        phoneNumberId,
        accessToken,
        graphVersion,
        to: m.from,
        body: reply,
      });
      if (!envio.ok) {
        console.error("[WhatsApp send]", envio.status, envio.data);
      }
    }
  } catch (err) {
    console.error("[webhook POST]", err);
  }

  return Response.json({}, { status: 200 });
}
