import { nssPendienteDeConsulta } from "@/lib/botStepsCore";
import type { BotRuntimeState } from "@/lib/conversationMemory";
import {
  construirMensajeReengagement,
  estadoPermiteReengagement,
  minutosDesde,
  resolverToquePendiente,
  TOQUE_1_DESDE_MINUTOS,
  TOQUE_1_HASTA_MINUTOS,
  TOQUE_2_DESDE_MINUTOS,
  TOQUE_2_HASTA_MINUTOS,
  type ReengagementTouch,
} from "@/lib/reengagement";
import {
  enviarToqueConReserva,
  esperaRespuestaDelCliente,
  ESTADOS_LEAD_REENGAGEMENT,
  leadsConAtencionHumana,
  mensajesPosteriores,
  nuevasMetricas,
  resumirFlujo,
  toque1EnEsteSilencio,
  ultimosEntrantesRecientes,
  type EntranteReciente,
  type MetricasCron,
  type ResumenFlujo,
} from "@/lib/reengagementEnvio";
import { ejecutarReengagementGeneradoresCron } from "@/lib/reengagementGeneradoresCron";
import { clientePausoORechazo } from "@/lib/reengagementPausa";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type LeadCron = {
  id: string;
  whatsapp_phone: string;
  estado: string;
  updated_at: string;
  producto: string | null;
  monto_aprobado_min: number | string | null;
  monto_aprobado_max: number | string | null;
  reengagement_1_sent_at: string | null;
  reengagement_2_sent_at: string | null;
};

type ConversacionCron = {
  whatsapp_phone: string;
  lead_id: string | null;
  state: string;
  producto: string | null;
  data: Record<string, unknown> | null;
};

type ResultadoLead = {
  lead_id: string;
  estado: "enviado" | "omitido" | "error";
  touch?: ReengagementTouch;
  motivo?: string;
  error?: string;
};

function enVentanaDeToque(minutos: number): boolean {
  return (
    (minutos >= TOQUE_1_DESDE_MINUTOS && minutos < TOQUE_1_HASTA_MINUTOS) ||
    (minutos >= TOQUE_2_DESDE_MINUTOS && minutos < TOQUE_2_HASTA_MINUTOS)
  );
}

function omitido(leadId: string, motivo: string): ResultadoLead {
  return { lead_id: leadId, estado: "omitido", motivo };
}

/** Lead y conversación confirman Mejoravit, el mismo lead y un estado de precalificación. */
function motivoConversacionNoConfirmada(
  lead: LeadCron,
  conv: ConversacionCron | undefined,
): string | null {
  if (!conv) return "conversacion_no_encontrada";
  if (lead.producto !== "mejoravit" || conv.producto !== "mejoravit") {
    return "producto_no_confirmado";
  }
  if (conv.lead_id && conv.lead_id !== lead.id) return "conversacion_de_otro_lead";
  if (!estadoPermiteReengagement(conv.state)) return "estado_conversacion_no_aplica";
  if (conv.state === "esperando_datos" && nssPendienteDeConsulta(conv.data ?? undefined)) {
    return "nss_ya_recibido";
  }
  return null;
}

async function enviarToque(args: {
  lead: LeadCron;
  convState: BotRuntimeState;
  entrante: EntranteReciente;
  ultimoMensajeAt: string;
  nowMs: number;
  metricas: MetricasCron;
}): Promise<ResultadoLead> {
  const { lead } = args;
  try {
    const touch = resolverToquePendiente({
      minutesSinceLastIncoming: minutosDesde(args.entrante.at, args.nowMs),
      reengagement1SentAt: lead.reengagement_1_sent_at,
      reengagement2SentAt: lead.reengagement_2_sent_at,
      leadUpdatedAt: lead.updated_at,
      nowMs: args.nowMs,
    });
    if (!touch) return omitido(lead.id, "fuera_de_ventana_o_ya_enviado");
    if (touch === 2 && !toque1EnEsteSilencio(lead.reengagement_1_sent_at, args.entrante.at)) {
      return omitido(lead.id, "toque_1_de_otra_conversacion");
    }

    const mensaje = construirMensajeReengagement(touch, args.convState, lead);
    if (!mensaje) return omitido(lead.id, "sin_mensaje_para_estado");

    const envio = await enviarToqueConReserva({
      leadId: lead.id,
      whatsappPhone: lead.whatsapp_phone,
      campo: touch === 1 ? "reengagement_1_sent_at" : "reengagement_2_sent_at",
      requiereCampo: touch === 2 ? "reengagement_1_sent_at" : undefined,
      mensaje,
      ultimoMensajeAt: args.ultimoMensajeAt,
      nowMs: args.nowMs,
      metricas: args.metricas,
    });
    if (envio.estado === "error") {
      return { lead_id: lead.id, estado: "error", touch, motivo: envio.motivo, error: envio.error };
    }
    if (envio.estado === "omitido") {
      return { lead_id: lead.id, estado: "omitido", touch, motivo: envio.motivo };
    }
    return { lead_id: lead.id, estado: "enviado", touch };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { lead_id: lead.id, estado: "error", motivo: "excepcion", error: msg };
  }
}

/**
 * Parte de la actividad reciente del cliente: 1 consulta si nadie escribió en los
 * últimos 30 minutos. Solo los leads cuyo silencio cae en una ventana de toque
 * llevan a leer leads, conversaciones, mensajes posteriores y acciones de asesor.
 */
export async function ejecutarReengagementMejoravitCron(
  nowMs = Date.now(),
): Promise<ResumenFlujo<ResultadoLead>> {
  const metricas = nuevasMetricas();
  const supabase = getSupabaseAdmin();

  const entrantes = await ultimosEntrantesRecientes({
    nowMs,
    ventanaMinutos: TOQUE_2_HASTA_MINUTOS,
    metricas,
  });
  const enVentana = [...entrantes].filter(([, e]) =>
    enVentanaDeToque(minutosDesde(e.at, nowMs)),
  );
  if (enVentana.length === 0) return resumirFlujo(0, [], metricas);

  metricas.consultas += 1;
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, whatsapp_phone, estado, updated_at, producto, monto_aprobado_min, monto_aprobado_max, reengagement_1_sent_at, reengagement_2_sent_at",
    )
    .in(
      "id",
      enVentana.map(([leadId]) => leadId),
    )
    .in("estado", [...ESTADOS_LEAD_REENGAGEMENT])
    .eq("producto", "mejoravit")
    .is("reengagement_2_sent_at", null);

  if (error) {
    throw new Error(`Error consultando leads: ${error.message}`);
  }

  const candidatos = (leads ?? []) as LeadCron[];
  if (candidatos.length === 0) return resumirFlujo(0, [], metricas);

  metricas.consultas += 1;
  const { data: convs, error: convsError } = await supabase
    .from("conversations")
    .select("whatsapp_phone, lead_id, state, producto, data")
    .in(
      "whatsapp_phone",
      candidatos.map((l) => l.whatsapp_phone),
    );

  if (convsError) {
    throw new Error(`Error consultando conversaciones: ${convsError.message}`);
  }

  const convPorPhone = new Map<string, ConversacionCron>();
  for (const row of (convs ?? []) as ConversacionCron[]) {
    convPorPhone.set(row.whatsapp_phone, row);
  }

  const resultados: ResultadoLead[] = [];
  const confirmados: { lead: LeadCron; conv: ConversacionCron; entrante: EntranteReciente }[] = [];
  for (const lead of candidatos) {
    const conv = convPorPhone.get(lead.whatsapp_phone);
    const motivo = motivoConversacionNoConfirmada(lead, conv);
    if (motivo) {
      resultados.push(omitido(lead.id, motivo));
    } else if (clientePausoORechazo("mejoravit", entrantes.get(lead.id)!.contenido)) {
      resultados.push(omitido(lead.id, "cliente_pauso_o_rechazo"));
    } else {
      confirmados.push({ lead, conv: conv!, entrante: entrantes.get(lead.id)! });
    }
  }
  if (confirmados.length === 0) {
    return resumirFlujo(candidatos.length, resultados, metricas);
  }

  const ids = confirmados.map((c) => c.lead.id);
  const desde = confirmados
    .map((c) => c.entrante.at)
    .reduce((a, b) => (Date.parse(a) < Date.parse(b) ? a : b));
  const posteriores = await mensajesPosteriores(ids, desde, metricas);
  const atendidos = await leadsConAtencionHumana(ids, metricas);

  for (const { lead, conv, entrante } of confirmados) {
    if (atendidos.has(lead.id)) {
      resultados.push(omitido(lead.id, "atencion_humana"));
      continue;
    }
    const espera = esperaRespuestaDelCliente(entrante.at, posteriores.get(lead.id) ?? []);
    if (!espera.ok) {
      resultados.push(omitido(lead.id, espera.motivo));
      continue;
    }
    resultados.push(
      await enviarToque({
        lead,
        convState: conv.state as BotRuntimeState,
        entrante,
        ultimoMensajeAt: espera.ultimoMensajeAt,
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
