import {
  deleteConversation,
  getConversation,
  reemplazarConversacion,
  setConversation,
} from "@/lib/conversationMemory";
import { productoForzadoDe } from "@/lib/detectarProducto";
import {
  actualizarLeadPorConversacion,
  ensureLeadProvisional,
} from "@/lib/leadProvisional";
import { buscarLeadPorTelefono } from "@/lib/messagesDb";
import {
  esPrecalificacionAprobada,
  iniciarTramiteTrasPrecalificacion,
} from "@/lib/botStepsTramite";
import { estimarCreditoMejoravit } from "@/lib/mejoravitCredito";
import { extraerNssOnceDigitos } from "@/lib/nss";
import {
  esAfirmativo,
  esComandoReinicio,
  esNegativo,
  normalizarTexto,
} from "@/lib/normalizeText";
import { MSG_CONTACTO_HORARIO } from "@/lib/reengagement";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { mensajeOferta } from "@/lib/tramiteMejoravit";
import { leerLeadConTramite } from "@/lib/tramiteMejoravitRepo";

export type BotState =
  | "inicio"
  | "esperando_labor_vigente"
  | "esperando_infonavit"
  | "esperando_credito_activo"
  | "esperando_datos"
  | "esperando_horario"
  | "tramite_mejoravit"
  | "finalizado";

export type ResultadoPaso = {
  texto: string;
  exacto: boolean;
};

export const MSG_BIENVENIDA =
  "Buenas tardes, gracias por contactarnos.\n\n" +
  "¿Actualmente tienes una relación laboral vigente en Nuevo León?";

export const MSG_RECHAZO_LABOR =
  "Gracias por contactarnos. Por el momento el crédito Mejoravit está disponible solo para trabajadores activos en Nuevo León. Si tu situación cambia, con gusto te podemos ayudar.";

export const MSG_INFONAVIT =
  "¿Actualmente estás dado de alta en Infonavit?";

export const MSG_RECHAZO_INFONAVIT =
  "Gracias por contactarnos. Para el crédito Mejoravit es necesario estar dado de alta en Infonavit. Cuando lo estés, escríbenos y te ayudamos.";

export const MSG_CREDITO_ACTIVO =
  "¿Actualmente estas pagando un crédito Infonavit?";

export const MSG_RECHAZO_CREDITO_ACTIVO =
  "Gracias por contactarnos. El crédito Mejoravit no aplica si ya tienes un crédito Infonavit activo.";

export const MSG_SOLICITUD_DATOS =
  "Compárteme tu Número de Seguro Social (NSS) para darte el monto autorizado.";

export const MSG_MONTO_Y_HORARIO = MSG_CONTACTO_HORARIO;

export const MSG_REINTENTO_HORARIO =
  "¿A qué hora te podemos llamar para explicarte todo? " +
  "Por ejemplo: hoy a las 3pm, mañana en la mañana, etc. 📞";

export const MSG_FINAL =
  "Gracias. Un asesor se pondrá en contacto contigo en el horario que nos indicaste.";

const MSG_NO_CALIFICA_SCRAPER =
  "Lo sentimos, en este momento no calificas para el crédito Mejoravit. " +
  "Si tienes dudas, puedes escribirnos cuando gustes.";

const MSG_OPT_OUT =
  "Entendido, no te molestaremos más. Si en algún momento cambias de opinión, con gusto te ayudamos 😊";

const FRASES_OPT_OUT = [
  "no me interesa",
  "ya no",
  "no gracias",
  "adios",
  "hasta luego",
  "no quiero",
  "dejame",
  "no por favor",
  "cancela",
] as const;

const MSG_NSS_INVALIDO =
  "Necesito un número de seguro social (IMSS) de 11 dígitos. Intenta de nuevo.\n\n" +
  MSG_SOLICITUD_DATOS;

export const MSG_CONSULTA_NO_DISPONIBLE =
  "Tuvimos un problema temporal al consultar tu información en Infonavit. " +
  "Ya tenemos tu NSS, no necesitas enviarlo de nuevo. " +
  "Escríbenos en unos minutos y lo volvemos a intentar.";

export const MSG_CONSULTA_EN_CURSO =
  "Sigo consultando tu información en Infonavit; en cuanto tenga el resultado te lo comparto por aquí. 😊";

/** Algo más que el timeout del scraper (180 s): mientras tanto no se lanza otra consulta. */
const VENTANA_CONSULTA_EN_CURSO_MS = 200_000;
/** Una precalificación aprobada del mismo NSS se reutiliza en lugar de volver a consultar Railway. */
const VIGENCIA_PRECALIFICACION_MS = 7 * 24 * 60 * 60 * 1000;

function consultaEnCurso(
  data: Record<string, unknown> | undefined,
  nss: string,
  ahoraMs: number,
): boolean {
  const inicio =
    typeof data?.consultaIniciadaAt === "string" ? Date.parse(data.consultaIniciadaAt) : NaN;
  return (
    data?.nssPendiente === nss &&
    Number.isFinite(inicio) &&
    ahoraMs - inicio < VENTANA_CONSULTA_EN_CURSO_MS
  );
}

/** NSS ya capturado cuya consulta al scraper no terminó; se reintenta sin volver a pedirlo. */
export function nssPendienteDeConsulta(
  data: Record<string, unknown> | undefined,
): string | null {
  const valor = data?.nssPendiente;
  return typeof valor === "string" && /^\d{11}$/.test(valor) ? valor : null;
}

type RespuestaScraper = {
  success?: boolean;
  califica?: boolean;
  nss?: string;
  nombre?: string | null;
  montoCredito?: number | string;
  datos?: {
    montoCredito?: number | string;
    saldoSubcuenta?: number | string;
  };
};

type DatosPrecalificacionAprobada = {
  saldoSubcuentaRaw: number | string;
  saldoSubcuenta: number;
  montoCreditoRaw?: number | string;
};

function extraerSaldoSubcuenta(resultado: RespuestaScraper): number {
  return parseNumero(resultado.datos?.saldoSubcuenta);
}

function horarioGuardadoEnConversacion(
  data: Record<string, unknown> | undefined,
): string {
  return typeof data?.horario === "string" ? data.horario : "";
}

const datosPrecalificacionPorTelefono = new Map<
  string,
  DatosPrecalificacionAprobada
>();

function parseNumero(value: number | string | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const limpio = value.replace(/[^0-9.]/g, "");
  const parsed = Number(limpio);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function consultarPrecalificacionScraper(
  nss: string,
): Promise<RespuestaScraper> {
  const scraperUrl = process.env.SCRAPER_URL || process.env.SCRAPER_SERVICE_URL;
  const scraperSecret = process.env.SCRAPER_SECRET;
  if (!scraperUrl || !scraperSecret) {
    throw new Error("SCRAPER_NO_CONFIGURADO");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(`${scraperUrl}/precalificar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-scraper-secret": scraperSecret,
      },
      body: JSON.stringify({ nss, workerIndex: 0 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const appInexistente = res.headers.get("x-railway-fallback") === "true";
      throw new Error(
        `SCRAPER_HTTP_${res.status}${appInexistente ? "_RAILWAY_APP_NO_ENCONTRADA" : ""}`,
      );
    }
    return (await res.json()) as RespuestaScraper;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Solo categorías técnicas: nunca incluye NSS, teléfono, secretos ni el cuerpo de la respuesta. */
function tipoErrorScraper(err: unknown): string {
  if (!(err instanceof Error)) return "desconocido";
  if (err.message === "SCRAPER_NO_CONFIGURADO") return "no_configurado";
  if (err.message.startsWith("SCRAPER_HTTP_")) return err.message.toLowerCase();
  if (err.name === "AbortError" || err.name === "TimeoutError") return "timeout";
  if (err instanceof SyntaxError) return "respuesta_no_json";
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  if (typeof code === "string") return `red_${code}`;
  return err.name === "TypeError" ? "red" : "desconocido";
}

export function preguntaDelEstado(state: BotState): string {
  switch (state) {
    case "esperando_labor_vigente":
      return MSG_BIENVENIDA;
    case "esperando_infonavit":
      return MSG_INFONAVIT;
    case "esperando_credito_activo":
      return MSG_CREDITO_ACTIVO;
    case "esperando_datos":
      return MSG_SOLICITUD_DATOS;
    case "esperando_horario":
      return MSG_MONTO_Y_HORARIO;
    default:
      return MSG_BIENVENIDA;
  }
}

export function tipoEsperadoDelEstado(
  state: BotState,
): "si_no" | "nss" | "horario" | "libre" {
  if (
    state === "esperando_labor_vigente" ||
    state === "esperando_infonavit" ||
    state === "esperando_credito_activo"
  ) {
    return "si_no";
  }
  if (state === "esperando_datos") return "nss";
  if (state === "esperando_horario") return "horario";
  return "libre";
}

export type EntradaInterpretada = {
  esSi?: boolean;
  esNo?: boolean;
  nss?: string | null;
  esHorarioValido?: boolean;
};

function exacto(texto: string): ResultadoPaso {
  return { texto, exacto: true };
}

export function esOptOut(texto: string): boolean {
  const n = normalizarTexto(texto);
  if (!n) return false;
  return FRASES_OPT_OUT.some((frase) => n.includes(frase));
}

export function mensajeFinalizadoPost(horario: string): string {
  const h = horario.trim();
  if (h) {
    return `Listo, un asesor te contactará ${h}. Si necesitas algo más llama al 8140100246.`;
  }
  return "Un asesor te contactará pronto. Si necesitas algo más llama al 8140100246.";
}

async function resolverHorarioParaMensaje(
  phone: string,
  data?: Record<string, unknown>,
): Promise<string> {
  const desdeData = horarioGuardadoEnConversacion(data);
  if (desdeData.trim()) return desdeData.trim();

  const conv = await getConversation(phone);
  const desdeConv = horarioGuardadoEnConversacion(conv.data);
  if (desdeConv.trim()) return desdeConv.trim();

  const leadId =
    conv.lead_id ?? (await buscarLeadPorTelefono(phone))?.id ?? null;
  if (!leadId) return "";

  try {
    const supabase = getSupabaseAdmin();
    const { data: lead } = await supabase
      .from("leads")
      .select("horario")
      .eq("id", leadId)
      .maybeSingle();
    return typeof lead?.horario === "string" ? lead.horario.trim() : "";
  } catch (err) {
    console.error("[lead] Error leyendo horario:", err);
    return "";
  }
}

export async function manejarOptOut(phone: string): Promise<ResultadoPaso> {
  datosPrecalificacionPorTelefono.delete(phone);
  const ok = await actualizarLeadPorConversacion(phone, {
    estado: "no_interesado",
  });
  if (!ok) {
    console.error("[lead] Error marcando lead no_interesado");
  }
  await setConversation(phone, {
    state: "finalizado",
    name: null,
    nss: null,
  });
  return exacto(MSG_OPT_OUT);
}

async function rechazar(phone: string, mensaje: string): Promise<ResultadoPaso> {
  datosPrecalificacionPorTelefono.delete(phone);
  const descalificadoOk = await actualizarLeadPorConversacion(phone, {
    estado: "descalificado",
  });
  if (!descalificadoOk) {
    console.error("[lead] Error marcando lead descalificado");
  }
  await setConversation(phone, {
    state: "finalizado",
    name: null,
    nss: null,
  });
  return exacto(mensaje);
}

async function responderSiNoCore(
  texto: string,
  entrada: EntradaInterpretada | undefined,
  onSi: () => Promise<ResultadoPaso>,
  onNo: () => Promise<ResultadoPaso>,
  reintento: ResultadoPaso,
): Promise<ResultadoPaso> {
  if (entrada?.esSi) return onSi();
  if (entrada?.esNo) return onNo();
  if (esAfirmativo(texto)) return onSi();
  if (esNegativo(texto)) return onNo();
  return reintento;
}

async function resolverNssGuardado(
  phone: string,
  row: { nss: string | null; data?: Record<string, unknown> },
): Promise<string | null> {
  if (typeof row.nss === "string" && row.nss.trim()) {
    return row.nss.trim();
  }
  if (typeof row.data?.nss === "string" && row.data.nss.trim()) {
    return row.data.nss.trim();
  }

  const leadId = await resolverLeadId(phone);
  if (!leadId) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data: lead } = await supabase
      .from("leads")
      .select("nss")
      .eq("id", leadId)
      .maybeSingle();
    const nss = typeof lead?.nss === "string" ? lead.nss.trim() : "";
    return nss || null;
  } catch (err) {
    console.error("[lead] Error leyendo NSS:", err);
    return null;
  }
}

async function procesarPrecalificacionParaLead(
  phone: string,
  nss: string,
): Promise<ResultadoPaso> {
  datosPrecalificacionPorTelefono.delete(phone);
  const leadIdNss = await resolverLeadId(phone);
  console.log("[lead confirmado]", { lead_id: leadIdNss });

  try {
    const previa = leadIdNss ? await precalificacionPreviaVigente(leadIdNss, nss) : null;
    const resultado = previa ?? (await consultarPrecalificacionScraper(nss));
    const saldoSubcuenta = extraerSaldoSubcuenta(resultado);
    const saldoSubcuentaRaw = resultado.datos?.saldoSubcuenta;
    const montoCreditoRaw =
      resultado.datos?.montoCredito ?? resultado.montoCredito;
    const success = resultado.success === true || resultado.califica === true;

    if (success && saldoSubcuenta > 0 && saldoSubcuentaRaw !== undefined) {
      return ofrecerTramite({
        phone,
        nss,
        leadId: leadIdNss,
        resultado,
        reutilizada: previa !== null,
        extrasLead: {
          saldo_subcuenta: saldoSubcuentaRaw,
          monto_base: saldoSubcuenta,
          monto_aprobado_min: saldoSubcuenta,
          monto_aprobado_max: saldoSubcuenta,
          ...(montoCreditoRaw !== undefined ? { monto_credito: montoCreditoRaw } : {}),
          precalificacion_status: "aprobado",
          precalificacion_resultado: resultado,
          precalificado_at: new Date().toISOString(),
          ...(typeof resultado.nombre === "string" && resultado.nombre.trim()
            ? { nombre_infonavit: resultado.nombre.trim() }
            : {}),
        },
      });
    }

    if (resultado.success === false || resultado.califica === false) {
      return rechazar(phone, MSG_NO_CALIFICA_SCRAPER);
    }

    console.error("[scraper] Precalificación fallida", {
      tipo: "respuesta_inesperada",
      lead_id: leadIdNss,
    });
    await liberarConsultaEnCurso(phone);
    return exacto(MSG_CONSULTA_NO_DISPONIBLE);
  } catch (err) {
    console.error("[scraper] Precalificación fallida", {
      tipo: tipoErrorScraper(err),
      lead_id: leadIdNss,
    });
    await liberarConsultaEnCurso(phone);
    return exacto(MSG_CONSULTA_NO_DISPONIBLE);
  }
}

/** Tras una falla, el siguiente mensaje puede reintentar de inmediato con el NSS guardado. */
async function liberarConsultaEnCurso(phone: string) {
  await setConversation(phone, {
    state: "esperando_datos",
    name: null,
    nss: null,
    data: { consultaIniciadaAt: null },
  });
}

/** Precalificación aprobada guardada en el lead para este mismo NSS y aún vigente. */
async function precalificacionPreviaVigente(
  leadId: string,
  nss: string,
): Promise<RespuestaScraper | null> {
  const lead = await leerLeadConTramite(leadId);
  if (!lead || lead.precalificacionStatus !== "aprobado") return null;
  const resultado = lead.precalificacionResultado as RespuestaScraper | null;
  const at = lead.precalificadoAt ? Date.parse(lead.precalificadoAt) : NaN;
  if (
    !resultado ||
    resultado.nss !== nss ||
    !esPrecalificacionAprobada(resultado) ||
    !Number.isFinite(at) ||
    Date.now() - at > VIGENCIA_PRECALIFICACION_MS
  ) {
    return null;
  }
  return resultado;
}

/** Precalificación exitosa: estima el crédito, inicia el trámite y ofrece continuar por el chat. */
async function ofrecerTramite(args: {
  phone: string;
  nss: string;
  leadId: string | null;
  resultado: RespuestaScraper;
  reutilizada: boolean;
  extrasLead: Record<string, unknown>;
}): Promise<ResultadoPaso> {
  const extrasLead = args.reutilizada ? {} : args.extrasLead;
  const tramite = args.leadId
    ? await iniciarTramiteTrasPrecalificacion({
        leadId: args.leadId,
        phone: args.phone,
        nss: args.nss,
        resultado: args.resultado,
        extrasLead,
      })
    : null;
  if (!tramite) {
    console.error("[tramite] No se pudo iniciar el trámite", { lead_id: args.leadId });
    if (Object.keys(extrasLead).length > 0) {
      await actualizarLeadPorConversacion(args.phone, extrasLead);
    }
  }
  console.log("[tramite] Oferta", {
    lead_id: args.leadId,
    precalificacion_reutilizada: args.reutilizada,
  });

  await setConversation(args.phone, {
    state: "tramite_mejoravit",
    name: null,
    nss: null,
    data: { nss: args.nss, nssPendiente: null, consultaIniciadaAt: null },
  });
  const monto =
    tramite?.credito.montoNetoEstimado ??
    estimarCreditoMejoravit(extraerSaldoSubcuenta(args.resultado)).montoNetoEstimado;
  return exacto(mensajeOferta(monto));
}

/**
 * Conversaciones del flujo anterior (pedía horario para un asesor): pasan al trámite.
 * Si el lead ya tiene saldo para este mismo NSS no se repite la consulta al portal.
 */
async function migrarDesdeEsperandoHorario(
  phone: string,
  row: { nss: string | null; data?: Record<string, unknown> },
): Promise<ResultadoPaso> {
  const nss = await resolverNssGuardado(phone, row);
  if (!nss) {
    await setConversation(phone, { state: "esperando_datos", name: null, nss: null });
    return exacto(MSG_SOLICITUD_DATOS);
  }

  const leadId = await resolverLeadId(phone);
  const lead = leadId ? await leerLeadConTramite(leadId) : null;
  const resultadoGuardado = lead?.precalificacionResultado as RespuestaScraper | null | undefined;
  const resultadoPrevio =
    lead?.precalificacionStatus === "aprobado" &&
    resultadoGuardado?.nss === nss &&
    esPrecalificacionAprobada(resultadoGuardado)
      ? resultadoGuardado
      : null;
  // Solo en memoria: el saldo del flujo anterior no se guarda como precalificacion_resultado.
  const saldoAnterior: RespuestaScraper | null =
    lead?.nss === nss && parseNumero(lead.saldoSubcuenta ?? undefined) > 0
      ? { success: true, nss, datos: { saldoSubcuenta: lead.saldoSubcuenta ?? undefined } }
      : null;
  const resultado = resultadoPrevio ?? saldoAnterior;

  console.log("[tramite] Migración desde esperando_horario", {
    lead_id: leadId,
    con_saldo: resultado !== null,
  });

  if (resultado) {
    return ofrecerTramite({
      phone,
      nss,
      leadId,
      resultado,
      reutilizada: true,
      extrasLead: {},
    });
  }

  await setConversation(phone, {
    state: "esperando_datos",
    name: null,
    nss: null,
    data: { nssPendiente: nss, consultaIniciadaAt: new Date().toISOString() },
  });
  return procesarPrecalificacionParaLead(phone, nss);
}

async function resolverLeadId(phone: string): Promise<string | null> {
  const conv = await getConversation(phone);
  if (conv.lead_id) return conv.lead_id;

  const existing = await buscarLeadPorTelefono(phone);
  if (existing) {
    await setConversation(phone, {
      state: conv.state,
      lead_id: existing.id,
    });
    return existing.id;
  }

  return ensureLeadProvisional(phone);
}

export async function reiniciarFlujoCore(phone: string): Promise<ResultadoPaso> {
  datosPrecalificacionPorTelefono.delete(phone);
  const conv = await getConversation(phone);
  if (conv.producto) {
    const leadId =
      conv.lead_id ??
      (await buscarLeadPorTelefono(phone))?.id ??
      (await ensureLeadProvisional(phone));
    const productoForzado = productoForzadoDe(conv.data);
    await reemplazarConversacion(phone, {
      state: "esperando_labor_vigente",
      nss: null,
      lead_id: leadId,
      producto: conv.producto,
      data: productoForzado ? { productoForzado } : {},
    });
    return exacto(MSG_BIENVENIDA);
  }
  await deleteConversation(phone);
  await setConversation(phone, {
    state: "esperando_labor_vigente",
    name: null,
    nss: null,
    lead_id: null,
  });
  await ensureLeadProvisional(phone);
  return exacto(MSG_BIENVENIDA);
}

export async function ejecutarPasoCore(args: {
  phone: string;
  textoUsuario: string;
  entrada?: EntradaInterpretada;
}): Promise<ResultadoPaso> {
  const texto = args.textoUsuario.trim();
  const phone = args.phone;
  const entrada = args.entrada;
  const row = await getConversation(phone);
  const state = row.state as BotState;

  if (state !== "inicio" && esOptOut(texto)) {
    return manejarOptOut(phone);
  }

  switch (state) {
    case "finalizado": {
      const horario = await resolverHorarioParaMensaje(phone, row.data);
      return exacto(mensajeFinalizadoPost(horario));
    }
    case "inicio":
      await ensureLeadProvisional(phone);
      await setConversation(phone, {
        state: "esperando_labor_vigente",
        name: null,
        nss: null,
      });
      return exacto(MSG_BIENVENIDA);
    case "esperando_labor_vigente":
      return await responderSiNoCore(
        texto,
        entrada,
        async () => {
          await setConversation(phone, {
            state: "esperando_infonavit",
            name: null,
            nss: null,
          });
          return exacto(MSG_INFONAVIT);
        },
        async () => rechazar(phone, MSG_RECHAZO_LABOR),
        exacto(MSG_BIENVENIDA),
      );
    case "esperando_infonavit":
      return await responderSiNoCore(
        texto,
        entrada,
        async () => {
          await setConversation(phone, {
            state: "esperando_credito_activo",
            name: null,
            nss: null,
          });
          return exacto(MSG_CREDITO_ACTIVO);
        },
        async () => rechazar(phone, MSG_RECHAZO_INFONAVIT),
        exacto(MSG_INFONAVIT),
      );
    case "esperando_credito_activo":
      return await responderSiNoCore(
        texto,
        entrada,
        async () => rechazar(phone, MSG_RECHAZO_CREDITO_ACTIVO),
        async () => {
          await setConversation(phone, {
            state: "esperando_datos",
            name: null,
            nss: null,
          });
          return exacto(MSG_SOLICITUD_DATOS);
        },
        exacto(MSG_CREDITO_ACTIVO),
      );
    case "esperando_datos": {
      const digitosTexto = texto.replace(/\D/g, "");
      const textoTieneNssValido = digitosTexto.length === 11;
      const nssTexto =
        textoTieneNssValido && entrada?.nss && /^\d{11}$/.test(entrada.nss)
          ? entrada.nss
          : extraerNssOnceDigitos(texto);
      const nssPendiente = nssPendienteDeConsulta(row.data);
      const nss = nssTexto ?? nssPendiente;
      if (!nss) {
        return exacto(MSG_NSS_INVALIDO);
      }
      if (consultaEnCurso(row.data, nss, Date.now())) {
        return exacto(MSG_CONSULTA_EN_CURSO);
      }

      const leadIdNss = await resolverLeadId(phone);
      const nssOk = await actualizarLeadPorConversacion(phone, { nss });
      if (!nssOk) {
        console.error("[lead] Error guardando NSS:", { lead_id: leadIdNss });
      }

      await setConversation(phone, {
        state: "esperando_datos",
        name: null,
        nss: null,
        data: { nssPendiente: nss, consultaIniciadaAt: new Date().toISOString() },
      });
      return procesarPrecalificacionParaLead(phone, nss);
    }
    case "esperando_horario":
      return migrarDesdeEsperandoHorario(phone, row);
    default:
      return await reiniciarFlujoCore(phone);
  }
}

export { esComandoReinicio };
