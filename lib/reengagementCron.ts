import type { BotRuntimeState } from "@/lib/conversationMemory";
import {
  construirMensajeReengagement,
  ESTADOS_REENGAGEMENT_MEJORAVIT,
  leadActualizadoRecientemente,
  minutosDesde,
  resolverToquePendiente,
  TOQUE_2_HASTA_MINUTOS,
  type ReengagementTouch,
} from "@/lib/reengagement";
import {
  enviarToqueConReserva,
  nuevasMetricas,
  resumirFlujo,
  ultimosEntrantesPorLead,
  type MetricasCron,
  type ResumenFlujo,
} from "@/lib/reengagementEnvio";
import { ejecutarReengagementGeneradoresCron } from "@/lib/reengagementGeneradoresCron";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const PRODUCTOS_LEAD_MEJORAVIT = ["mejoravit", "sin_clasificar"];

type LeadCron = {
  id: string;
  whatsapp_phone: string;
  updated_at: string;
  producto?: string | null;
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

async function procesarLead(args: {
  lead: LeadCron;
  convState: BotRuntimeState;
  ultimoEntranteAt: string | undefined;
  nowMs: number;
  metricas: MetricasCron;
}): Promise<ResultadoLead> {
  const { lead } = args;
  const base: ResultadoLead = { lead_id: lead.id, estado: "omitido" };

  try {
    if (!args.ultimoEntranteAt) {
      return { ...base, motivo: "sin_mensaje_entrante_reciente" };
    }

    const touch = resolverToquePendiente({
      minutesSinceLastIncoming: minutosDesde(args.ultimoEntranteAt, args.nowMs),
      reengagement1SentAt: lead.reengagement_1_sent_at,
      reengagement2SentAt: lead.reengagement_2_sent_at,
      leadUpdatedAt: lead.updated_at,
      nowMs: args.nowMs,
    });
    if (!touch) {
      return { ...base, motivo: "fuera_de_ventana_o_ya_enviado" };
    }

    const mensaje = construirMensajeReengagement(touch, args.convState, lead);
    if (!mensaje) {
      return { ...base, motivo: "sin_mensaje_para_estado" };
    }

    const envio = await enviarToqueConReserva({
      leadId: lead.id,
      whatsappPhone: lead.whatsapp_phone,
      campo: touch === 1 ? "reengagement_1_sent_at" : "reengagement_2_sent_at",
      requiereCampo: touch === 2 ? "reengagement_1_sent_at" : undefined,
      mensaje,
      ultimoEntranteAt: args.ultimoEntranteAt,
      nowMs: args.nowMs,
      metricas: args.metricas,
    });
    if (envio.estado === "error") {
      return { ...base, estado: "error", touch, motivo: envio.motivo, error: envio.error };
    }
    if (envio.estado === "omitido") {
      return { ...base, touch, motivo: envio.motivo };
    }
    return { lead_id: lead.id, estado: "enviado", touch };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { lead_id: lead.id, estado: "error", motivo: "excepcion", error: msg };
  }
}

/**
 * Solo evalúa leads `nuevo` de Mejoravit con algún toque pendiente y conversación
 * Mejoravit en un estado que admite recordatorio. Consultas: 1 si no hay candidatos;
 * hasta 3 de selección más 3 por envío (reserva, verificación e historial).
 */
export async function ejecutarReengagementMejoravitCron(
  nowMs = Date.now(),
): Promise<ResumenFlujo<ResultadoLead>> {
  const metricas = nuevasMetricas();
  const supabase = getSupabaseAdmin();

  metricas.consultas += 1;
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, whatsapp_phone, updated_at, producto, monto_aprobado_min, monto_aprobado_max, reengagement_1_sent_at, reengagement_2_sent_at",
    )
    .eq("estado", "nuevo")
    .in("producto", PRODUCTOS_LEAD_MEJORAVIT)
    .is("reengagement_2_sent_at", null);

  if (error) {
    throw new Error(`Error consultando leads: ${error.message}`);
  }

  const candidatos = (leads ?? []) as LeadCron[];
  const resultados: ResultadoLead[] = [];
  const porEvaluar: LeadCron[] = [];
  for (const lead of candidatos) {
    if (leadActualizadoRecientemente(lead.updated_at, nowMs)) {
      resultados.push({ lead_id: lead.id, estado: "omitido", motivo: "lead_actualizado_recientemente" });
    } else {
      porEvaluar.push(lead);
    }
  }
  if (porEvaluar.length === 0) {
    return resumirFlujo(candidatos.length, resultados, metricas);
  }

  metricas.consultas += 1;
  const { data: convs, error: convsError } = await supabase
    .from("conversations")
    .select("whatsapp_phone, state")
    .in(
      "whatsapp_phone",
      porEvaluar.map((l) => l.whatsapp_phone),
    )
    .eq("producto", "mejoravit")
    .in("state", [...ESTADOS_REENGAGEMENT_MEJORAVIT]);

  if (convsError) {
    throw new Error(`Error consultando conversaciones: ${convsError.message}`);
  }

  const estadoPorPhone = new Map<string, BotRuntimeState>();
  for (const row of (convs ?? []) as { whatsapp_phone: string; state: BotRuntimeState }[]) {
    estadoPorPhone.set(row.whatsapp_phone, row.state);
  }

  const conConversacion = porEvaluar.filter((lead) => {
    if (estadoPorPhone.has(lead.whatsapp_phone)) return true;
    resultados.push({ lead_id: lead.id, estado: "omitido", motivo: "estado_conversacion_no_aplica" });
    return false;
  });
  if (conConversacion.length === 0) {
    return resumirFlujo(candidatos.length, resultados, metricas);
  }

  const ultimos = await ultimosEntrantesPorLead(
    conConversacion.map((l) => l.id),
    new Date(nowMs - TOQUE_2_HASTA_MINUTOS * 60_000).toISOString(),
    metricas,
  );

  for (const lead of conConversacion) {
    resultados.push(
      await procesarLead({
        lead,
        convState: estadoPorPhone.get(lead.whatsapp_phone)!,
        ultimoEntranteAt: ultimos.get(lead.id),
        nowMs,
        metricas,
      }),
    );
  }

  return resumirFlujo(candidatos.length, resultados, metricas);
}

export async function ejecutarReengagementCron(nowMs = Date.now()) {
  const inicio = Date.now();
  const mejoravit = await ejecutarReengagementMejoravitCron(nowMs);
  const generadores = await ejecutarReengagementGeneradoresCron(nowMs);

  return {
    duracion_ms: Date.now() - inicio,
    candidatos: mejoravit.candidatos + generadores.candidatos,
    enviados: mejoravit.enviados + generadores.enviados,
    omitidos: mejoravit.omitidos + generadores.omitidos,
    errores: mejoravit.errores + generadores.errores,
    consultas: mejoravit.consultas + generadores.consultas,
    mejoravit,
    generadores,
  };
}

type ResumenCron = Awaited<ReturnType<typeof ejecutarReengagementCron>>;

function metricasFlujo(flujo: ResumenFlujo<{ estado: ResultadoLead["estado"] }>) {
  return {
    candidatos: flujo.candidatos,
    enviados: flujo.enviados,
    omitidos: flujo.omitidos,
    errores: flujo.errores,
    consultas: flujo.consultas,
    motivos: flujo.motivos,
  };
}

/** Solo conteos: sin IDs de lead, teléfonos ni contenido de mensajes. */
export function metricasCronSinDatosPersonales(resumen: ResumenCron) {
  return {
    duracion_ms: resumen.duracion_ms,
    candidatos: resumen.candidatos,
    enviados: resumen.enviados,
    omitidos: resumen.omitidos,
    errores: resumen.errores,
    consultas: resumen.consultas,
    mejoravit: metricasFlujo(resumen.mejoravit),
    generadores: metricasFlujo(resumen.generadores),
  };
}
