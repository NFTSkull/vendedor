import type { NextRequest } from "next/server";

import { procesarYEvolucionar } from "@/lib/botSteps";
import { getConversation } from "@/lib/conversationMemory";
import { ensureLeadProvisional } from "@/lib/leadProvisional";
import {
  buscarLeadPorId,
  buscarLeadPorTelefono,
  guardarMensaje,
  type LeadRow,
} from "@/lib/messagesDb";
import { getMetaWebhookVerificationResponse } from "@/lib/metaWebhookVerification";
import { extraerNssOnceDigitos } from "@/lib/nss";
import { enviarPushNuevoLead } from "@/lib/pushNotifications";
import { extraerTextosEntrantes, payloadDebeIgnorarPorEcos } from "@/lib/parseWhatsAppWebhook";
import { resolveWhatsAppAccount } from "@/lib/whatsappAccountResolver";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

export const runtime = "nodejs";
const ultimoWamidPorTelefono = new Map<string, string>();

function isMultiNumberEnabled(): boolean {
  return process.env.WHATSAPP_MULTI_NUMBER_ENABLED === "true";
}

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

  if (isMultiNumberEnabled()) {
    try {
      if (payloadDebeIgnorarPorEcos(payload)) {
        console.log("[WEBHOOK_DEBUG] eco WhatsApp ignorado (multi-número)");
        return Response.json({}, { status: 200 });
      }
    } catch (err) {
      console.error("[webhook] error detectando ecos WhatsApp, continúa flujo normal:", err);
    }
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion =
    process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.GRAPH_API_VERSION;
  const mensajes = extraerTextosEntrantes(payload);
  if (!accessToken || !phoneNumberId) {
    console.error(
      "Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID en el entorno",
    );
    return Response.json({}, { status: 200 });
  }

  for (const m of mensajes) {
    let resolvedAccessToken = accessToken;
    let resolvedPhoneNumberId = phoneNumberId;

    if (isMultiNumberEnabled()) {
      try {
        const account = await resolveWhatsAppAccount(m.phoneNumberId ?? undefined);
        if (account?.accessToken && account.phoneNumberId) {
          resolvedAccessToken = account.accessToken;
          resolvedPhoneNumberId = account.phoneNumberId;
        }
      } catch (err) {
        console.error("[webhook] resolveWhatsAppAccount fallback env:", err);
      }
    }

    if (m.wamid) {
      const ultimo = ultimoWamidPorTelefono.get(m.from);
      if (ultimo === m.wamid) {
        console.log("[WEBHOOK_DEBUG] mensaje duplicado ignorado:", m.wamid);
        continue;
      }
      ultimoWamidPorTelefono.set(m.from, m.wamid);
    }

    console.log("[WEBHOOK_DEBUG] from extraído (parseWhatsAppWebhook):", m.from);

    const leadAntes = await buscarLeadPorTelefono(m.from);
    await ensureLeadProvisional(m.from);
    const conversacionLead = await getConversation(m.from);

    let leadChat: LeadRow | null = null;
    if (conversacionLead.lead_id) {
      leadChat =
        (await buscarLeadPorId(conversacionLead.lead_id)) ??
        ({
          id: conversacionLead.lead_id,
          whatsapp_phone: m.from,
          estado: "nuevo",
        } satisfies LeadRow);
    }
    if (!leadChat) {
      leadChat = await buscarLeadPorTelefono(m.from);
    }
    if (!leadAntes && leadChat) {
      await enviarPushNuevoLead({
        leadId: leadChat.id,
        telefono: leadChat.whatsapp_phone,
        horario: null,
      });
    }

    let mensajeEntranteGuardado = false;
    const mensajesSalientesExitosos: string[] = [];

    async function guardarMensajeSiHayLead(
      direccion: "entrante" | "saliente",
      contenido: string,
    ): Promise<boolean> {
      if (!leadChat) {
        const conv = await getConversation(m.from);
        if (conv.lead_id) {
          leadChat =
            (await buscarLeadPorId(conv.lead_id)) ??
            ({
              id: conv.lead_id,
              whatsapp_phone: m.from,
              estado: "nuevo",
            } satisfies LeadRow);
        } else {
          leadChat = await buscarLeadPorTelefono(m.from);
        }
      }
      if (!leadChat) return false;
      return guardarMensaje({
        leadId: leadChat.id,
        direccion,
        contenido,
      });
    }

    async function flushHistorialPendiente(): Promise<void> {
      if (!mensajeEntranteGuardado) {
        try {
          mensajeEntranteGuardado = await guardarMensajeSiHayLead("entrante", m.body);
        } catch (err) {
          console.error("[webhook] Error guardando mensaje entrante (post-creación):", err);
        }
      }

      while (mensajesSalientesExitosos.length > 0) {
        const contenido = mensajesSalientesExitosos.shift();
        if (!contenido) continue;
        try {
          await guardarMensajeSiHayLead("saliente", contenido);
        } catch (err) {
          console.error("[webhook] Error guardando mensaje saliente:", err);
        }
      }
    }

    try {
      if (leadChat) {
        mensajeEntranteGuardado = await guardarMensajeSiHayLead("entrante", m.body);
      }
    } catch (err) {
      console.error("[webhook] Error guardando mensaje entrante:", err);
    }

    if (leadChat?.estado === "contactado") {
      continue;
    }

    const conversacionAntes = await getConversation(m.from);
    if (
      conversacionAntes.state === "esperando_datos" &&
      extraerNssOnceDigitos(m.body)
    ) {
      const espera = await enviarMensajeTextoWa({
        phoneNumberId: resolvedPhoneNumberId,
        accessToken: resolvedAccessToken,
        graphVersion,
        to: m.from,
        body: "Un momento, estoy consultando tu información en Infonavit... ⏳",
      });
      if (!espera.ok) {
        console.error("[WhatsApp wait]", espera.status, espera.data);
      } else {
        mensajesSalientesExitosos.push(
          "Un momento, estoy consultando tu información en Infonavit... ⏳",
        );
      }
    }

    const reply = await procesarYEvolucionar({
      phone: m.from,
      textoUsuario: m.body,
    });

    if (!reply) {
      await flushHistorialPendiente();
      continue;
    }

    console.log("[WEBHOOK_DEBUG] to usado en Graph (enviarMensajeTextoWa):", m.from);

    const envio = await enviarMensajeTextoWa({
      phoneNumberId: resolvedPhoneNumberId,
      accessToken: resolvedAccessToken,
      graphVersion,
      to: m.from,
      body: reply,
    });
    if (!envio.ok) {
      console.error("[WhatsApp send]", envio.status, envio.data);
    } else {
      mensajesSalientesExitosos.push(reply);
    }

    await flushHistorialPendiente();
  }

  return Response.json({}, { status: 200 });
}
