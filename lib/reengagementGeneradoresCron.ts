import { guardarMensaje } from "@/lib/messagesDb";
import {
  construirMensajeReengagementGeneradores,
  conversacionElegibleGeneradores,
  dentroVentana24hWhatsApp,
  minutosDesdeUltimoEntrante,
  parseGenStep,
  resolverToquePendienteGeneradores,
  type GenReengagementTouch,
} from "@/lib/reengagementGeneradores";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

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

async function marcarToqueGeneradoresEnviado(
  leadId: string,
  touch: GenReengagementTouch,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const campo =
    touch === 1 ? "gen_reengagement_1_sent_at" : "gen_reengagement_2_sent_at";
  const { error } = await supabase
    .from("leads")
    .update({ [campo]: new Date().toISOString() })
    .eq("id", leadId);

  if (error) {
    throw new Error(`Error actualizando ${campo}: ${error.message}`);
  }
}

async function enviarWhatsAppGeneradores(args: {
  whatsappPhone: string;
  mensaje: string;
}): Promise<void> {
  // Producción: WHATSAPP_PHONE_NUMBER_ID = 1177472778778882 (Concasa / generadores).
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
    to: args.whatsappPhone,
    body: args.mensaje,
  });

  if (!envio.ok) {
    throw new Error(`WhatsApp error ${envio.status}`);
  }
}

async function procesarLeadGeneradores(
  lead: LeadGeneradoresCron,
  conv: ConversacionGeneradores | undefined,
  nowMs: number,
): Promise<ResultadoLeadGeneradores> {
  const base: ResultadoLeadGeneradores = {
    lead_id: lead.id,
    estado: "omitido",
  };

  try {
    const genStep = parseGenStep(conv?.data);

    if (
      !conversacionElegibleGeneradores({
        producto: conv?.producto ?? lead.producto,
        state: conv?.state,
        genStep,
        leadEstado: lead.estado,
      })
    ) {
      return { ...base, motivo: "conversacion_no_elegible" };
    }

    const ultimoEntranteAt = await obtenerUltimoMensajeEntrante(lead.id);
    if (!ultimoEntranteAt) {
      return { ...base, motivo: "sin_mensaje_entrante" };
    }

    const minutesSince = minutosDesdeUltimoEntrante(ultimoEntranteAt, nowMs);

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

    const mensaje = construirMensajeReengagementGeneradores(genStep!);

    await enviarWhatsAppGeneradores({
      whatsappPhone: lead.whatsapp_phone,
      mensaje,
    });

    const guardado = await guardarMensaje({
      leadId: lead.id,
      direccion: "saliente",
      contenido: mensaje,
      origen: "bot",
    });
    if (!guardado) {
      throw new Error("Mensaje enviado pero no se guardó en historial");
    }

    await marcarToqueGeneradoresEnviado(lead.id, touch);

    return {
      lead_id: lead.id,
      estado: "enviado",
      touch,
      genStep: genStep ?? undefined,
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

export async function ejecutarReengagementGeneradoresCron(
  nowMs = Date.now(),
): Promise<{
  procesados: number;
  enviados: number;
  omitidos: number;
  errores: number;
  resultados: ResultadoLeadGeneradores[];
}> {
  const supabase = getSupabaseAdmin();

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select(
      "id, whatsapp_phone, estado, producto, gen_reengagement_1_sent_at, gen_reengagement_2_sent_at",
    )
    .eq("estado", "nuevo")
    .eq("producto", "generadores");

  if (leadsError) {
    throw new Error(`Error consultando leads generadores: ${leadsError.message}`);
  }

  const candidatos = (leads ?? []) as LeadGeneradoresCron[];
  if (candidatos.length === 0) {
    return {
      procesados: 0,
      enviados: 0,
      omitidos: 0,
      errores: 0,
      resultados: [],
    };
  }

  const phones = candidatos.map((l) => l.whatsapp_phone);
  const { data: convs, error: convsError } = await supabase
    .from("conversations")
    .select("whatsapp_phone, state, producto, data")
    .in("whatsapp_phone", phones)
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

  for (const lead of candidatos) {
    resultados.push(
      await procesarLeadGeneradores(
        lead,
        convPorPhone.get(lead.whatsapp_phone),
        nowMs,
      ),
    );
  }

  return {
    procesados: resultados.length,
    enviados: resultados.filter((r) => r.estado === "enviado").length,
    omitidos: resultados.filter((r) => r.estado === "omitido").length,
    errores: resultados.filter((r) => r.estado === "error").length,
    resultados,
  };
}
