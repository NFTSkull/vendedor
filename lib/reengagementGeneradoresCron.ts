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
import {
  construirMensajeReengagementGeneradores,
  conversacionElegibleGeneradores,
  dentroVentana24hWhatsApp,
  GEN_TOQUE_1_MIN_MINUTES,
  GEN_TOQUE_1_WINDOW_MINUTES,
  GEN_TOQUE_2_MIN_MINUTES,
  GEN_TOQUE_2_WINDOW_MINUTES,
  minutosDesdeUltimoEntrante,
  parseGenStep,
  resolverToquePendienteGeneradores,
  type GenReengagementTouch,
  type GenStep,
} from "@/lib/reengagementGeneradores";
import { clientePausoORechazo } from "@/lib/reengagementPausa";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type LeadGeneradoresCron = {
  id: string;
  whatsapp_phone: string;
  estado: string;
  producto: string | null;
  gen_reengagement_1_sent_at: string | null;
  gen_reengagement_2_sent_at: string | null;
};

type ConversacionGeneradores = {
  whatsapp_phone: string;
  lead_id: string | null;
  state: string;
  producto: string | null;
  data: unknown;
};

export type ResultadoLeadGeneradores = {
  lead_id: string;
  estado: "enviado" | "omitido" | "error";
  touch?: GenReengagementTouch;
  genStep?: string;
  motivo?: string;
  error?: string;
};

const GEN_TOQUE_2_HASTA_MINUTOS = GEN_TOQUE_2_MIN_MINUTES + GEN_TOQUE_2_WINDOW_MINUTES;

function enVentanaDeToque(minutos: number): boolean {
  return (
    (minutos >= GEN_TOQUE_1_MIN_MINUTES &&
      minutos < GEN_TOQUE_1_MIN_MINUTES + GEN_TOQUE_1_WINDOW_MINUTES) ||
    (minutos >= GEN_TOQUE_2_MIN_MINUTES && minutos < GEN_TOQUE_2_HASTA_MINUTOS)
  );
}

function omitido(leadId: string, motivo: string): ResultadoLeadGeneradores {
  return { lead_id: leadId, estado: "omitido", motivo };
}

// Producción: WHATSAPP_PHONE_NUMBER_ID = 1177472778778882 (Concasa / generadores).
async function enviarToqueGeneradores(args: {
  lead: LeadGeneradoresCron;
  genStep: GenStep;
  entrante: EntranteReciente;
  ultimoMensajeAt: string;
  nowMs: number;
  metricas: MetricasCron;
}): Promise<ResultadoLeadGeneradores> {
  const { lead, genStep } = args;
  try {
    const minutesSince = minutosDesdeUltimoEntrante(args.entrante.at, args.nowMs);
    if (!dentroVentana24hWhatsApp(minutesSince)) {
      return omitido(lead.id, "fuera_ventana_24h_whatsapp");
    }

    const touch = resolverToquePendienteGeneradores({
      minutesSinceLastIncoming: minutesSince,
      genReengagement1SentAt: lead.gen_reengagement_1_sent_at,
      genReengagement2SentAt: lead.gen_reengagement_2_sent_at,
    });
    if (!touch) return omitido(lead.id, "fuera_de_ventana_o_ya_enviado");
    if (touch === 2 && !toque1EnEsteSilencio(lead.gen_reengagement_1_sent_at, args.entrante.at)) {
      return omitido(lead.id, "toque_1_de_otra_conversacion");
    }

    const envio = await enviarToqueConReserva({
      leadId: lead.id,
      whatsappPhone: lead.whatsapp_phone,
      campo: touch === 1 ? "gen_reengagement_1_sent_at" : "gen_reengagement_2_sent_at",
      requiereCampo: touch === 2 ? "gen_reengagement_1_sent_at" : undefined,
      mensaje: construirMensajeReengagementGeneradores(genStep),
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
    return { lead_id: lead.id, estado: "enviado", touch, genStep };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { lead_id: lead.id, estado: "error", motivo: "excepcion", error: msg };
  }
}

/** Mismas reglas comerciales; parte de la actividad reciente en lugar de recorrer leads. */
export async function ejecutarReengagementGeneradoresCron(
  nowMs = Date.now(),
): Promise<ResumenFlujo<ResultadoLeadGeneradores>> {
  const metricas = nuevasMetricas();
  const supabase = getSupabaseAdmin();

  const entrantes = await ultimosEntrantesRecientes({
    nowMs,
    ventanaMinutos: GEN_TOQUE_2_HASTA_MINUTOS,
    metricas,
  });
  const enVentana = [...entrantes].filter(([, e]) =>
    enVentanaDeToque(minutosDesdeUltimoEntrante(e.at, nowMs)),
  );
  if (enVentana.length === 0) return resumirFlujo(0, [], metricas);

  metricas.consultas += 1;
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select(
      "id, whatsapp_phone, estado, producto, gen_reengagement_1_sent_at, gen_reengagement_2_sent_at",
    )
    .in(
      "id",
      enVentana.map(([leadId]) => leadId),
    )
    .in("estado", [...ESTADOS_LEAD_REENGAGEMENT])
    .eq("producto", "generadores")
    .or("gen_reengagement_1_sent_at.is.null,gen_reengagement_2_sent_at.is.null");

  if (leadsError) {
    throw new Error(`Error consultando leads generadores: ${leadsError.message}`);
  }

  const candidatos = (leads ?? []) as LeadGeneradoresCron[];
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
    throw new Error(
      `Error consultando conversaciones generadores: ${convsError.message}`,
    );
  }

  const convPorPhone = new Map<string, ConversacionGeneradores>();
  for (const row of (convs ?? []) as ConversacionGeneradores[]) {
    convPorPhone.set(row.whatsapp_phone, row);
  }

  const resultados: ResultadoLeadGeneradores[] = [];
  const confirmados: {
    lead: LeadGeneradoresCron;
    genStep: GenStep;
    entrante: EntranteReciente;
  }[] = [];
  for (const lead of candidatos) {
    const conv = convPorPhone.get(lead.whatsapp_phone);
    const genStep = parseGenStep(conv?.data);
    const entrante = entrantes.get(lead.id)!;
    if (!conv || conv.producto !== "generadores" || lead.producto !== "generadores") {
      resultados.push(omitido(lead.id, "producto_no_confirmado"));
    } else if (conv.lead_id && conv.lead_id !== lead.id) {
      resultados.push(omitido(lead.id, "conversacion_de_otro_lead"));
    } else if (
      !genStep ||
      !conversacionElegibleGeneradores({
        producto: conv.producto,
        state: conv.state,
        genStep,
        leadEstado: lead.estado,
      })
    ) {
      resultados.push(omitido(lead.id, "conversacion_no_elegible"));
    } else if (clientePausoORechazo("generadores", entrante.contenido)) {
      resultados.push(omitido(lead.id, "cliente_pauso_o_rechazo"));
    } else {
      confirmados.push({ lead, genStep, entrante });
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

  for (const { lead, genStep, entrante } of confirmados) {
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
      await enviarToqueGeneradores({
        lead,
        genStep,
        entrante,
        ultimoMensajeAt: espera.ultimoMensajeAt,
        nowMs,
        metricas,
      }),
    );
  }

  return resumirFlujo(candidatos.length, resultados, metricas);
}
