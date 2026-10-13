import { ACCIONES_INTERVENCION_ASESOR } from "@/lib/intervencionAsesor";
import { guardarMensaje } from "@/lib/messagesDb";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enviarMensajeTextoWa } from "@/lib/whatsappCloud";

export type CampoToque =
  | "reengagement_1_sent_at"
  | "reengagement_2_sent_at"
  | "gen_reengagement_1_sent_at"
  | "gen_reengagement_2_sent_at";

/** `contactado` lo pone el webhook tras cada respuesta del bot; `nuevo`, al recibir un mensaje. */
export const ESTADOS_LEAD_REENGAGEMENT = ["nuevo", "contactado"] as const;

/**
 * Solo cuenta actividad del cliente posterior a la activación de recordatorios para
 * leads `contactado`: evita reactivar conversaciones históricas.
 */
export const RECORDATORIOS_ACTIVIDAD_DESDE_ISO = "2026-10-13T22:50:00.000Z";

/** Mayor que el máximo histórico de mensajes entrantes en un día (419). */
const LIMITE_ENTRANTES_RECIENTES = 1000;

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

export type EntranteReciente = { at: string; contenido: string };

/**
 * Último mensaje entrante de cada lead con actividad reciente, en una sola consulta.
 * Los leads sin actividad desde `max(activación, ahora - ventana)` no se leen.
 */
export async function ultimosEntrantesRecientes(args: {
  nowMs: number;
  ventanaMinutos: number;
  metricas: MetricasCron;
}): Promise<Map<string, EntranteReciente>> {
  const desdeMs = Math.max(
    Date.parse(RECORDATORIOS_ACTIVIDAD_DESDE_ISO),
    args.nowMs - args.ventanaMinutos * 60_000,
  );
  const ultimos = new Map<string, EntranteReciente>();
  if (desdeMs >= args.nowMs) return ultimos;

  args.metricas.consultas += 1;
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .select("lead_id, contenido, created_at")
    .eq("direccion", "entrante")
    .gte("created_at", new Date(desdeMs).toISOString())
    .order("created_at", { ascending: false })
    .limit(LIMITE_ENTRANTES_RECIENTES);

  if (error) {
    throw new Error(`Error consultando mensajes recientes: ${error.message}`);
  }

  const filas = (data ?? []) as { lead_id: unknown; contenido: unknown; created_at: unknown }[];
  if (filas.length >= LIMITE_ENTRANTES_RECIENTES) {
    console.warn("[cron reengagement] Actividad reciente truncada al límite de consulta");
  }
  for (const fila of filas) {
    if (
      typeof fila.lead_id === "string" &&
      typeof fila.created_at === "string" &&
      !ultimos.has(fila.lead_id)
    ) {
      ultimos.set(fila.lead_id, {
        at: fila.created_at,
        contenido: typeof fila.contenido === "string" ? fila.contenido : "",
      });
    }
  }
  return ultimos;
}

type MensajePosterior = { direccion: string; origen: string | null; created_at: string };

/** Mensajes de cada lead posteriores a `desdeIso`, del más reciente al más antiguo. */
export async function mensajesPosteriores(
  leadIds: string[],
  desdeIso: string,
  metricas: MetricasCron,
): Promise<Map<string, MensajePosterior[]>> {
  const porLead = new Map<string, MensajePosterior[]>();
  if (leadIds.length === 0) return porLead;

  metricas.consultas += 1;
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .select("lead_id, direccion, origen, created_at")
    .in("lead_id", leadIds)
    .gt("created_at", desdeIso)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error consultando mensajes posteriores: ${error.message}`);
  }

  for (const fila of (data ?? []) as (MensajePosterior & { lead_id: string })[]) {
    const lista = porLead.get(fila.lead_id) ?? [];
    lista.push({ direccion: fila.direccion, origen: fila.origen, created_at: fila.created_at });
    porLead.set(fila.lead_id, lista);
  }
  return porLead;
}

export type EsperaRespuestaCliente =
  | { ok: true; ultimoMensajeAt: string }
  | {
      ok: false;
      motivo: "cliente_respondio" | "atencion_humana" | "pendiente_respuesta_bot";
    };

/**
 * El cliente tiene una pregunta del bot sin responder: después de su último mensaje
 * solo hay mensajes del bot. Si no hay respuesta del bot, el mensaje sigue pendiente.
 */
export function esperaRespuestaDelCliente(
  entranteAt: string,
  mensajesDelLead: MensajePosterior[],
): EsperaRespuestaCliente {
  const entranteMs = Date.parse(entranteAt);
  const posteriores = mensajesDelLead.filter((m) => Date.parse(m.created_at) > entranteMs);
  if (posteriores.some((m) => m.direccion === "entrante")) {
    return { ok: false, motivo: "cliente_respondio" };
  }
  if (posteriores.some((m) => m.origen !== "bot")) {
    return { ok: false, motivo: "atencion_humana" };
  }
  if (posteriores.length === 0) {
    return { ok: false, motivo: "pendiente_respuesta_bot" };
  }
  return { ok: true, ultimoMensajeAt: posteriores[0].created_at };
}

/**
 * Leads atendidos por una persona: la intervención que detiene al bot en el webhook
 * (`ACCIONES_INTERVENCION_ASESOR`) o cualquier acción registrada por un asesor, como
 * un cambio manual de estado en el CRM.
 */
export async function leadsConAtencionHumana(
  leadIds: string[],
  metricas: MetricasCron,
): Promise<Set<string>> {
  const atendidos = new Set<string>();
  if (leadIds.length === 0) return atendidos;

  metricas.consultas += 1;
  const { data, error } = await getSupabaseAdmin()
    .from("lead_actions")
    .select("lead_id")
    .in("lead_id", leadIds)
    .or(`accion.in.(${ACCIONES_INTERVENCION_ASESOR.join(",")}),advisor_id.not.is.null`);

  if (error) {
    throw new Error(`Error consultando acciones de asesor: ${error.message}`);
  }
  for (const fila of (data ?? []) as { lead_id: unknown }[]) {
    if (typeof fila.lead_id === "string") atendidos.add(fila.lead_id);
  }
  return atendidos;
}

/** El toque 1 solo habilita el toque 2 si se envió en este mismo silencio del cliente. */
export function toque1EnEsteSilencio(toque1At: string | null, entranteAt: string): boolean {
  return toque1At != null && Date.parse(toque1At) > Date.parse(entranteAt);
}

export type MotivoOmisionEnvio =
  | "reservado_por_otra_ejecucion"
  | "conversacion_cambio_antes_de_enviar";

export type MotivoErrorEnvio =
  | "whatsapp_rechazado"
  | "envio_incierto"
  | "historial_no_guardado";

export type ResultadoEnvioToque =
  | { estado: "enviado" }
  | { estado: "omitido"; motivo: MotivoOmisionEnvio }
  | { estado: "error"; motivo: MotivoErrorEnvio; error: string };

/**
 * Reserva atómica: solo una ejecución logra pasar el campo de NULL a una marca, y solo
 * mientras el lead siga en un estado de atención automática.
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
    .in("estado", [...ESTADOS_LEAD_REENGAGEMENT])
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

/** Cualquier mensaje nuevo (del cliente, de un asesor o de otro proceso) cancela el envío. */
async function huboMensajesDespues(
  leadId: string,
  ultimoMensajeAt: string,
  metricas: MetricasCron,
): Promise<boolean> {
  metricas.consultas += 1;
  const { data, error } = await getSupabaseAdmin()
    .from("messages")
    .select("id")
    .eq("lead_id", leadId)
    .gt("created_at", ultimoMensajeAt)
    .limit(1);

  if (error) {
    throw new Error(`Error verificando la conversación: ${error.message}`);
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
 * Reserva → verifica que la conversación no cambió → envía → guarda historial.
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
  ultimoMensajeAt: string;
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
    if (await huboMensajesDespues(args.leadId, args.ultimoMensajeAt, args.metricas)) {
      await liberar();
      return { estado: "omitido", motivo: "conversacion_cambio_antes_de_enviar" };
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
