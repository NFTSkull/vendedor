import { guardarMensaje } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

export type CampoToque =
  | "reengagement_1_sent_at"
  | "reengagement_2_sent_at"
  | "gen_reengagement_1_sent_at"
  | "gen_reengagement_2_sent_at";

export type MetricasCron = { consultas: number };

export function nuevasMetricas(): MetricasCron {
  return { consultas: 0 };
}

type ResultadoBase = {
  estado: "enviado" | "omitido" | "error";
  motivo?: string;
};

export type ResumenFlujo<R extends ResultadoBase> = {
  candidatos: number;
  enviados: number;
  omitidos: number;
  errores: number;
  consultas: number;
  motivos: Record<string, number>;
  resultados: R[];
};

export function resumirFlujo<R extends ResultadoBase>(
  candidatos: number,
  resultados: R[],
  metricas: MetricasCron,
): ResumenFlujo<R> {
  const motivos: Record<string, number> = {};
  for (const r of resultados) {
    if (r.motivo) motivos[r.motivo] = (motivos[r.motivo] ?? 0) + 1;
  }
  return {
    candidatos,
    enviados: resultados.filter((r) => r.estado === "enviado").length,
    omitidos: resultados.filter((r) => r.estado === "omitido").length,
    errores: resultados.filter((r) => r.estado === "error").length,
    consultas: metricas.consultas,
    motivos,
    resultados,
  };
}

export type MotivoOmisionEnvio =
  | "reservado_por_otra_ejecucion"
  | "cliente_respondio";

export type MotivoErrorEnvio =
  | "whatsapp_rechazado"
  | "envio_incierto"
  | "historial_no_guardado";

export type ResultadoEnvioToque =
  | { estado: "enviado" }
  | { estado: "omitido"; motivo: MotivoOmisionEnvio }
  | { estado: "error"; motivo: MotivoErrorEnvio; error: string };

/** Último mensaje entrante de cada lead posterior a `desdeIso`, en una sola consulta. */
export async function ultimosEntrantesPorLead(
  leadIds: string[],
  desdeIso: string,
  metricas: MetricasCron,
): Promise<Map<string, string>> {
  const ultimos = new Map<string, string>();
  if (leadIds.length === 0) return ultimos;

  metricas.consultas += 1;
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .select("lead_id, created_at")
    .in("lead_id", leadIds)
    .eq("direccion", "entrante")
    .gte("created_at", desdeIso)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error consultando mensajes: ${error.message}`);
  }

  for (const fila of (data ?? []) as { lead_id: unknown; created_at: unknown }[]) {
    if (
      typeof fila.lead_id === "string" &&
      typeof fila.created_at === "string" &&
      !ultimos.has(fila.lead_id)
    ) {
      ultimos.set(fila.lead_id, fila.created_at);
    }
  }
  return ultimos;
}

/**
 * Reserva atómica: solo una ejecución logra pasar el campo de NULL a una marca.
 * La marca es la misma columna `*_sent_at` que antes se escribía después de enviar.
 */
async function reservarToque(args: {
  leadId: string;
  campo: CampoToque;
  requiereCampo?: CampoToque;
  marca: string;
  metricas: MetricasCron;
}): Promise<boolean> {
  args.metricas.consultas += 1;
  let query = getSupabaseAdmin()
    .from("leads")
    .update({ [args.campo]: args.marca })
    .eq("id", args.leadId)
    .eq("estado", "nuevo")
    .is(args.campo, null);
  if (args.requiereCampo) {
    query = query.not(args.requiereCampo, "is", null);
  }
  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(`Error reservando ${args.campo}: ${error.message}`);
  }
  return Array.isArray(data) && data.length === 1;
}

/** Libera solo la reserva propia; si otra ejecución ya la cambió, no la toca. */
async function liberarToque(args: {
  leadId: string;
  campo: CampoToque;
  marca: string;
  metricas: MetricasCron;
}): Promise<void> {
  args.metricas.consultas += 1;
  const { error } = await getSupabaseAdmin()
    .from("leads")
    .update({ [args.campo]: null })
    .eq("id", args.leadId)
    .eq(args.campo, args.marca);

  if (error) {
    throw new Error(`Error liberando ${args.campo}: ${error.message}`);
  }
}

async function clienteEscribioDespues(
  leadId: string,
  ultimoEntranteAt: string,
  metricas: MetricasCron,
): Promise<boolean> {
  metricas.consultas += 1;
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .select("id")
    .eq("lead_id", leadId)
    .eq("direccion", "entrante")
    .gt("created_at", ultimoEntranteAt)
    .limit(1);

  if (error) {
    throw new Error(`Error verificando respuesta del cliente: ${error.message}`);
  }
  return Array.isArray(data) && data.length > 0;
}

function credencialesWhatsApp(): {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
} {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error("Faltan credenciales de WhatsApp en el entorno");
  }
  return {
    accessToken,
    phoneNumberId,
    graphVersion:
      process.env.WHATSAPP_GRAPH_API_VERSION ?? process.env.GRAPH_API_VERSION,
  };
}

/**
 * Reserva → verifica que el cliente no haya escrito → envía → guarda historial.
 *
 * Política ante fallos (a lo más un envío por toque):
 * - Meta responde 4xx: el mensaje no salió; se libera la reserva y la siguiente
 *   ejecución puede reintentarlo si sigue dentro de la ventana.
 * - Meta responde 5xx o la red falla: no se sabe si salió; la reserva se conserva.
 * - Falla el historial después de enviar: la reserva se conserva.
 */
export async function enviarToqueConReserva(args: {
  leadId: string;
  whatsappPhone: string;
  campo: CampoToque;
  requiereCampo?: CampoToque;
  mensaje: string;
  ultimoEntranteAt: string;
  nowMs: number;
  metricas: MetricasCron;
}): Promise<ResultadoEnvioToque> {
  const credenciales = credencialesWhatsApp();
  const marca = new Date(args.nowMs).toISOString();

  const reservado = await reservarToque({
    leadId: args.leadId,
    campo: args.campo,
    requiereCampo: args.requiereCampo,
    marca,
    metricas: args.metricas,
  });
  if (!reservado) {
    return { estado: "omitido", motivo: "reservado_por_otra_ejecucion" };
  }

  const liberar = () =>
    liberarToque({
      leadId: args.leadId,
      campo: args.campo,
      marca,
      metricas: args.metricas,
    });

  try {
    if (
      await clienteEscribioDespues(
        args.leadId,
        args.ultimoEntranteAt,
        args.metricas,
      )
    ) {
      await liberar();
      return { estado: "omitido", motivo: "cliente_respondio" };
    }
  } catch (err) {
    await liberar();
    throw err;
  }

  let envio: Awaited<ReturnType<typeof enviarMensajeTextoWa>>;
  try {
    envio = await enviarMensajeTextoWa({
      ...credenciales,
      to: args.whatsappPhone,
      body: args.mensaje,
    });
  } catch {
    return {
      estado: "error",
      motivo: "envio_incierto",
      error: "Fallo de red al enviar a WhatsApp",
    };
  }

  if (!envio.ok) {
    if (envio.status >= 400 && envio.status < 500) {
      await liberar();
      return {
        estado: "error",
        motivo: "whatsapp_rechazado",
        error: `WhatsApp error ${envio.status}`,
      };
    }
    return {
      estado: "error",
      motivo: "envio_incierto",
      error: `WhatsApp error ${envio.status}`,
    };
  }

  args.metricas.consultas += 1;
  const guardado = await guardarMensaje({
    leadId: args.leadId,
    direccion: "saliente",
    contenido: args.mensaje,
    origen: "bot",
  });
  if (!guardado) {
    return {
      estado: "error",
      motivo: "historial_no_guardado",
      error: "Mensaje enviado pero no se guardó en historial",
    };
  }

  return { estado: "enviado" };
}
