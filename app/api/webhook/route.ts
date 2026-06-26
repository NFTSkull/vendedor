import type { NextRequest } from "next/server";

import { procesarYEvolucionar } from "@/lib/botSteps";
import { getConversation } from "@/lib/conversationMemory";
import { detectarPrefijoAsesor, ADVISOR_ID_ADMIN } from "@/lib/detectarProducto";
import { ensureLeadProvisional } from "@/lib/leadProvisional";
import {
  buscarLeadPorId,
  buscarLeadPorTelefono,
  guardarMensaje,
  type LeadRow,
} from "@/lib/messagesDb";
import { getMetaWebhookVerificationResponse } from "@/lib/metaWebhookVerification";
import { extraerNssOnceDigitos } from "@/lib/nss";
import { enviarPushNuevoLead, enviarPushNuevoMensaje } from "@/lib/pushNotifications";
import { extraerTextosEntrantes, payloadDebeIgnorarPorEcos } from "@/lib/parseWhatsAppWebhook";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveWhatsAppAccount } from "@/lib/whatsappAccountResolver";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

export const runtime = "nodejs";
const ultimoWamidPorTelefono = new Map<string, string>();

const ESTADOS_PUSH_MENSAJE_ENTRANTE = new Set([
  "contactado",
  "nuevo",
  "no_interesado",
]);

const MSG_SOLO_TEXTO =
  "Solo puedo procesar mensajes de texto por el momento. " +
  "Por favor escribe tu respuesta 😊";

type WhatsAppNonTextInbound = {
  from: string;
  wamid: string | null;
  phoneNumberId: string | null;
};

function extraerPhoneNumberIdDeValue(value: Record<string, unknown>): string | null {
  const metadata = value.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const id = (metadata as Record<string, unknown>).phone_number_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function extraerMensajesNoTextoEntrantes(body: unknown): WhatsAppNonTextInbound[] {
  if (!body || typeof body !== "object") return [];
  const entry = (body as Record<string, unknown>).entry;
  if (!Array.isArray(entry)) return [];

  const result: WhatsAppNonTextInbound[] = [];
  for (const ent of entry) {
    if (!ent || typeof ent !== "object") continue;
    const changes = (ent as Record<string, unknown>).changes;
    if (!Array.isArray(changes)) continue;
    for (const ch of changes) {
      if (!ch || typeof ch !== "object") continue;
      const field = (ch as Record<string, unknown>).field;
      if (field !== "messages") continue;
      const value = (ch as Record<string, unknown>).value;
      if (!value || typeof value !== "object") continue;
      const phoneNumberId = extraerPhoneNumberIdDeValue(value as Record<string, unknown>);
      const messages = (value as Record<string, unknown>).messages;
      if (!Array.isArray(messages)) continue;

      for (const raw of messages) {
        if (!raw || typeof raw !== "object") continue;
        const m = raw as Record<string, unknown>;
        const from = m.from;
        if (typeof from !== "string" || !from.trim()) continue;
        const type = m.type;
        if (type === "text" || typeof type !== "string") continue;
        const wamid = typeof m.id === "string" ? m.id : null;
        result.push({ from: from.trim(), wamid, phoneNumberId });
      }
    }
  }
  return result;
}

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
  const mensajesNoTexto = extraerMensajesNoTextoEntrantes(payload);
  if (!accessToken || !phoneNumberId) {
    console.error(
      "Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID en el entorno",
    );
    return Response.json({}, { status: 200 });
  }

  for (const m of mensajesNoTexto) {
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
        console.log("[WEBHOOK_DEBUG] mensaje no-texto duplicado ignorado:", m.wamid);
        continue;
      }
      ultimoWamidPorTelefono.set(m.from, m.wamid);
    }

    await ensureLeadProvisional(m.from, {
      phoneNumberId: resolvedPhoneNumberId,
    });

    const leadNoTexto = await buscarLeadPorTelefono(m.from);
    if (leadNoTexto?.estado === "contactado") {
      continue;
    }

    const envioNoTexto = await enviarMensajeTextoWa({
      phoneNumberId: resolvedPhoneNumberId,
      accessToken: resolvedAccessToken,
      graphVersion,
      to: m.from,
      body: MSG_SOLO_TEXTO,
    });
    if (!envioNoTexto.ok) {
      console.error("[WhatsApp send non-text]", envioNoTexto.status, envioNoTexto.data);
      continue;
    }

    const convNoTexto = await getConversation(m.from);
    const leadIdNoTexto =
      convNoTexto.lead_id ?? leadNoTexto?.id ?? (await buscarLeadPorTelefono(m.from))?.id;
    if (leadIdNoTexto) {
      try {
        await guardarMensaje({
          leadId: leadIdNoTexto,
          direccion: "saliente",
          contenido: MSG_SOLO_TEXTO,
          origen: "bot",
        });
      } catch (err) {
        console.error("[webhook] Error guardando mensaje saliente no-texto:", err);
      }
    }
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

    const convPrefijo = await getConversation(m.from);
    let textoProcesar = m.body;
    let advisorIdDetectado: string | null = null;
    if (convPrefijo.state === "inicio") {
      const prefijo = detectarPrefijoAsesor(m.body);
      advisorIdDetectado = prefijo.advisorId;
      textoProcesar = prefijo.textoLimpio;
      if (advisorIdDetectado) {
        console.log("[webhook] Prefijo asesor detectado:", {
          from: m.from,
          advisorId: advisorIdDetectado,
        });
      }
    }

    const leadAntes = await buscarLeadPorTelefono(m.from);
    await ensureLeadProvisional(m.from, {
      phoneNumberId: resolvedPhoneNumberId,
      primerMensaje: textoProcesar,
      advisorId: advisorIdDetectado,
    });
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
        advisorId:
          leadChat.advisor_id ?? advisorIdDetectado ?? ADVISOR_ID_ADMIN,
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
        origen: direccion === "entrante" ? "cliente" : "bot",
      });
    }

    async function flushHistorialPendiente(): Promise<void> {
      if (!mensajeEntranteGuardado) {
        try {
          mensajeEntranteGuardado = await guardarMensajeSiHayLead("entrante", textoProcesar);
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
        mensajeEntranteGuardado = await guardarMensajeSiHayLead("entrante", textoProcesar);
      }
    } catch (err) {
      console.error("[webhook] Error guardando mensaje entrante:", err);
    }

    if (
      leadAntes &&
      leadChat &&
      ESTADOS_PUSH_MENSAJE_ENTRANTE.has(leadChat.estado)
    ) {
      try {
        await enviarPushNuevoMensaje({
          leadId: leadChat.id,
          telefono: leadChat.whatsapp_phone,
          mensaje: textoProcesar,
          advisorId: leadChat.advisor_id ?? null,
        });
      } catch (err) {
        console.error("[webhook] Error enviando push nuevo mensaje:", err);
      }
    }

    const leadFresh = await buscarLeadPorTelefono(m.from);
    if (leadFresh?.estado === "contactado") {
      try {
        const supabase = getSupabaseAdmin();
        await supabase
          .from("leads")
          .update({ estado: "nuevo" })
          .eq("id", leadFresh.id);
      } catch (err) {
        console.error("[webhook] Error actualizando contactado→nuevo:", err);
      }

      await flushHistorialPendiente();
      try {
        await enviarPushNuevoMensaje({
          leadId: leadFresh.id,
          telefono: leadFresh.whatsapp_phone,
          mensaje: textoProcesar,
          advisorId: leadFresh.advisor_id ?? null,
        });
      } catch (err) {
        console.error("[webhook] Error push mensaje en lead contactado:", err);
      }
      continue;
    }

    if (leadChat?.id) {
      try {
        const supabase = getSupabaseAdmin();
        const { data: intervencion } = await supabase
          .from("lead_actions")
          .select("id")
          .eq("lead_id", leadChat.id)
          .in("accion", ["mensaje_asesor", "archivo_asesor"])
          .limit(1)
          .maybeSingle();

        if (intervencion) {
          await flushHistorialPendiente();
          try {
            await enviarPushNuevoMensaje({
              leadId: leadChat.id,
              telefono: leadChat.whatsapp_phone,
              mensaje: textoProcesar,
              advisorId: leadChat.advisor_id ?? null,
            });
          } catch (err) {
            console.error("[webhook] Error push post-intervencion:", err);
          }
          continue;
        }
      } catch (err) {
        console.error("[webhook] Error verificando intervencion asesor:", err);
      }
    }

    const conversacionAntes = await getConversation(m.from);
    if (
      conversacionAntes.state === "esperando_datos" &&
      extraerNssOnceDigitos(textoProcesar)
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
      textoUsuario: textoProcesar,
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
