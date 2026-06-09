import type { BotRuntimeState } from "@/lib/conversationMemory";
import { guardarMensaje } from "@/lib/messagesDb";
import {
  construirMensajeReengagement,
  estadoPermiteReengagement,
  minutosDesde,
  resolverToquePendiente,
  type ReengagementTouch,
} from "@/lib/reengagement";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

type LeadCron = {
  id: string;
  whatsapp_phone: string;
  updated_at: string;
  monto_aprobado_min: number | string | null;
  monto_aprobado_max: number | string | null;
  reengagement_1_sent_at: string | null;
  reengagement_2_sent_at: string | null;
};

type ResultadoLead = {
  lead_id: string;
  estado: "enviado" | "omitido" | "error";
  touch?: ReengagementTouch;
  motivo?: string;
  error?: string;
};

async function obtenerUltimoMensajeEntrante(
  leadId: string,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("messages")
    .select("created_at")
    .eq("lead_id", leadId)
    .eq("direccion", "entrante")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Error consultando mensajes: ${error.message}`);
  }

  return typeof data?.created_at === "string" ? data.created_at : null;
}

async function obtenerEstadoConversacion(
  whatsappPhone: string,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("conversations")
    .select("state")
    .eq("whatsapp_phone", whatsappPhone)
    .maybeSingle();

  if (error) {
    throw new Error(`Error consultando conversación: ${error.message}`);
  }

  return typeof data?.state === "string" ? data.state : null;
}

async function marcarToqueEnviado(
  leadId: string,
  touch: ReengagementTouch,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const campo =
    touch === 1 ? "reengagement_1_sent_at" : "reengagement_2_sent_at";
  const { error } = await supabase
    .from("leads")
    .update({ [campo]: new Date().toISOString() })
    .eq("id", leadId);

  if (error) {
    throw new Error(`Error actualizando ${campo}: ${error.message}`);
  }
}

async function procesarLead(lead: LeadCron, nowMs: number): Promise<ResultadoLead> {
  const base: ResultadoLead = {
    lead_id: lead.id,
    estado: "omitido",
  };

  try {
    const ultimoEntranteAt = await obtenerUltimoMensajeEntrante(lead.id);
    if (!ultimoEntranteAt) {
      return { ...base, motivo: "sin_mensaje_entrante" };
    }

    const minutesSince = minutosDesde(ultimoEntranteAt, nowMs);
    const touch = resolverToquePendiente({
      minutesSinceLastIncoming: minutesSince,
      reengagement1SentAt: lead.reengagement_1_sent_at,
      reengagement2SentAt: lead.reengagement_2_sent_at,
      leadUpdatedAt: lead.updated_at,
      nowMs,
    });

    if (!touch) {
      return { ...base, motivo: "fuera_de_ventana_o_ya_enviado" };
    }

    const convState = await obtenerEstadoConversacion(lead.whatsapp_phone);
    if (!convState || !estadoPermiteReengagement(convState)) {
      return { ...base, motivo: "estado_conversacion_no_aplica" };
    }

    const mensaje = construirMensajeReengagement(
      touch,
      convState as BotRuntimeState,
      lead,
    );
    if (!mensaje) {
      return { ...base, motivo: "sin_mensaje_para_estado" };
    }

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const graphVersion =
      process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.GRAPH_API_VERSION;

    if (!accessToken || !phoneNumberId) {
      throw new Error("Faltan credenciales de WhatsApp en el entorno");
    }

    const envio = await enviarMensajeTextoWa({
      phoneNumberId,
      accessToken,
      graphVersion,
      to: lead.whatsapp_phone,
      body: mensaje,
    });

    if (!envio.ok) {
      throw new Error(`WhatsApp error ${envio.status}`);
    }

    const guardado = await guardarMensaje({
      leadId: lead.id,
      direccion: "saliente",
      contenido: mensaje,
    });
    if (!guardado) {
      throw new Error("Mensaje enviado pero no se guardó en historial");
    }

    await marcarToqueEnviado(lead.id, touch);

    return {
      lead_id: lead.id,
      estado: "enviado",
      touch,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      lead_id: lead.id,
      estado: "error",
      error: msg,
    };
  }
}

export async function ejecutarReengagementCron(nowMs = Date.now()): Promise<{
  procesados: number;
  enviados: number;
  omitidos: number;
  errores: number;
  resultados: ResultadoLead[];
}> {
  const supabase = getSupabaseAdmin();
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, whatsapp_phone, updated_at, monto_aprobado_min, monto_aprobado_max, reengagement_1_sent_at, reengagement_2_sent_at",
    )
    .eq("estado", "nuevo");

  if (error) {
    throw new Error(`Error consultando leads: ${error.message}`);
  }

  const candidatos = (leads ?? []) as LeadCron[];
  const resultados: ResultadoLead[] = [];

  for (const lead of candidatos) {
    resultados.push(await procesarLead(lead, nowMs));
  }

  return {
    procesados: resultados.length,
    enviados: resultados.filter((r) => r.estado === "enviado").length,
    omitidos: resultados.filter((r) => r.estado === "omitido").length,
    errores: resultados.filter((r) => r.estado === "error").length,
    resultados,
  };
}
