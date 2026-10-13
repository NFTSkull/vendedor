import {
  enviarToqueConReserva,
  nuevasMetricas,
  resumirFlujo,
  ultimosEntrantesPorLead,
  type MetricasCron,
  type ResumenFlujo,
} from "@/lib/reengagementEnvio";
import {
  construirMensajeReengagementGeneradores,
  conversacionElegibleGeneradores,
  dentroVentana24hWhatsApp,
  GEN_WHATSAPP_VENTANA_MAX_MINUTES,
  minutosDesdeUltimoEntrante,
  parseGenStep,
  resolverToquePendienteGeneradores,
  type GenReengagementTouch,
  type GenStep,
} from "@/lib/reengagementGeneradores";
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

// Producción: WHATSAPP_PHONE_NUMBER_ID = 1177472778778882 (Concasa / generadores).
async function procesarLeadGeneradores(args: {
  lead: LeadGeneradoresCron;
  genStep: GenStep;
  ultimoEntranteAt: string | undefined;
  nowMs: number;
  metricas: MetricasCron;
}): Promise<ResultadoLeadGeneradores> {
  const { lead, genStep } = args;
  const base: ResultadoLeadGeneradores = { lead_id: lead.id, estado: "omitido" };

  try {
    if (!args.ultimoEntranteAt) {
      return { ...base, motivo: "fuera_ventana_24h_whatsapp" };
    }

    const minutesSince = minutosDesdeUltimoEntrante(args.ultimoEntranteAt, args.nowMs);
    if (!dentroVentana24hWhatsApp(minutesSince)) {
      return { ...base, motivo: "fuera_ventana_24h_whatsapp" };
    }

    const touch = resolverToquePendienteGeneradores({
      minutesSinceLastIncoming: minutesSince,
      genReengagement1SentAt: lead.gen_reengagement_1_sent_at,
      genReengagement2SentAt: lead.gen_reengagement_2_sent_at,
    });
    if (!touch) {
      return { ...base, motivo: "fuera_de_ventana_o_ya_enviado" };
    }

    const envio = await enviarToqueConReserva({
      leadId: lead.id,
      whatsappPhone: lead.whatsapp_phone,
      campo: touch === 1 ? "gen_reengagement_1_sent_at" : "gen_reengagement_2_sent_at",
      requiereCampo: touch === 2 ? "gen_reengagement_1_sent_at" : undefined,
      mensaje: construirMensajeReengagementGeneradores(genStep),
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
    return { lead_id: lead.id, estado: "enviado", touch, genStep };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { lead_id: lead.id, estado: "error", motivo: "excepcion", error: msg };
  }
}

/** Mismas reglas comerciales; el último mensaje entrante se carga en una sola consulta. */
export async function ejecutarReengagementGeneradoresCron(
  nowMs = Date.now(),
): Promise<ResumenFlujo<ResultadoLeadGeneradores>> {
  const metricas = nuevasMetricas();
  const supabase = getSupabaseAdmin();

  metricas.consultas += 1;
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select(
      "id, whatsapp_phone, estado, producto, gen_reengagement_1_sent_at, gen_reengagement_2_sent_at",
    )
    .eq("estado", "nuevo")
    .eq("producto", "generadores")
    .or("gen_reengagement_1_sent_at.is.null,gen_reengagement_2_sent_at.is.null");

  if (leadsError) {
    throw new Error(`Error consultando leads generadores: ${leadsError.message}`);
  }

  const candidatos = (leads ?? []) as LeadGeneradoresCron[];
  if (candidatos.length === 0) {
    return resumirFlujo(0, [], metricas);
  }

  metricas.consultas += 1;
  const { data: convs, error: convsError } = await supabase
    .from("conversations")
    .select("whatsapp_phone, state, producto, data")
    .in(
      "whatsapp_phone",
      candidatos.map((l) => l.whatsapp_phone),
    )
    .eq("producto", "generadores")
    .neq("state", "finalizado");

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
  const elegibles: { lead: LeadGeneradoresCron; genStep: GenStep }[] = [];
  for (const lead of candidatos) {
    const conv = convPorPhone.get(lead.whatsapp_phone);
    const genStep = parseGenStep(conv?.data);
    if (
      genStep &&
      conversacionElegibleGeneradores({
        producto: conv?.producto ?? lead.producto,
        state: conv?.state,
        genStep,
        leadEstado: lead.estado,
      })
    ) {
      elegibles.push({ lead, genStep });
    } else {
      resultados.push({ lead_id: lead.id, estado: "omitido", motivo: "conversacion_no_elegible" });
    }
  }
  if (elegibles.length === 0) {
    return resumirFlujo(candidatos.length, resultados, metricas);
  }

  const ultimos = await ultimosEntrantesPorLead(
    elegibles.map((e) => e.lead.id),
    new Date(nowMs - GEN_WHATSAPP_VENTANA_MAX_MINUTES * 60_000).toISOString(),
    metricas,
  );

  for (const { lead, genStep } of elegibles) {
    resultados.push(
      await procesarLeadGeneradores({
        lead,
        genStep,
        ultimoEntranteAt: ultimos.get(lead.id),
        nowMs,
        metricas,
      }),
    );
  }

  return resumirFlujo(candidatos.length, resultados, metricas);
}
