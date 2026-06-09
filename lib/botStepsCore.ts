import {
  deleteConversation,
  getConversation,
  setConversation,
} from "@/lib/conversationMemory";
import {
  actualizarLeadPorConversacion,
  ensureLeadProvisional,
} from "@/lib/leadProvisional";
import { buscarLeadPorTelefono } from "@/lib/messagesDb";
import { extraerNssOnceDigitos } from "@/lib/nss";
import {
  esAfirmativo,
  esComandoReinicio,
  esNegativo,
  normalizarTexto,
} from "@/lib/normalizeText";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type BotState =
  | "inicio"
  | "esperando_labor_vigente"
  | "esperando_infonavit"
  | "esperando_credito_activo"
  | "esperando_datos"
  | "esperando_horario"
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

export const MSG_MONTO_Y_HORARIO =
  "¿En qué día y horario te podemos contactar para darte más detalles?";

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

const MSG_REINTENTO_PRECIFICACION =
  "Por favor, comparte nuevamente tu número de seguro social (NSS) de 11 dígitos para continuar con la consulta.\n\n" +
  MSG_SOLICITUD_DATOS;

type RespuestaScraper = {
  success?: boolean;
  califica?: boolean;
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

function mensajeMontoAutorizado(saldoSubcuenta: number): string {
  return `Tu monto autorizado es:\n${formatMoneda(saldoSubcuenta)} 🏠`;
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

function formatMoneda(value: number): string {
  return `$${Math.floor(value).toLocaleString("es-MX")}`;
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
      throw new Error(`SCRAPER_HTTP_${res.status}`);
    }
    return (await res.json()) as RespuestaScraper;
  } finally {
    clearTimeout(timeoutId);
  }
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

async function manejarOptOut(phone: string): Promise<ResultadoPaso> {
  datosPrecalificacionPorTelefono.delete(phone);
  const ok = await actualizarLeadPorConversacion(phone, {
    estado: "no_interesado",
  });
  if (!ok) {
    console.error("[lead] Error marcando lead no_interesado:", { phone });
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
    console.error("[lead] Error marcando lead descalificado:", { phone });
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

async function guardarLead(
  phone: string,
  nss: string,
  horario: string,
  datosPrecalificacion?: DatosPrecalificacionAprobada,
) {
  const leadPayload: Record<string, unknown> = {
    nss,
    horario,
    estado: "nuevo",
  };
  if (datosPrecalificacion) {
    leadPayload.saldo_subcuenta = datosPrecalificacion.saldoSubcuentaRaw;
    leadPayload.monto_base = datosPrecalificacion.saldoSubcuenta;
    leadPayload.monto_aprobado_min = datosPrecalificacion.saldoSubcuenta;
    leadPayload.monto_aprobado_max = datosPrecalificacion.saldoSubcuenta;
    if (datosPrecalificacion.montoCreditoRaw !== undefined) {
      leadPayload.monto_credito = datosPrecalificacion.montoCreditoRaw;
    }
  }

  const leadId = await resolverLeadId(phone);
  if (!leadId) {
    console.error("[lead] No se pudo resolver lead_id:", { phone, nss, horario });
    return;
  }

  const ok = await actualizarLeadPorConversacion(phone, leadPayload);
  if (!ok) {
    console.error("[Supabase] Error actualizando lead:", { phone, nss, horario, lead_id: leadId });
  } else {
    console.log("[Supabase] Lead actualizado:", { phone, nss, horario, lead_id: leadId });
  }
}

export async function reiniciarFlujoCore(phone: string): Promise<ResultadoPaso> {
  datosPrecalificacionPorTelefono.delete(phone);
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
            state: "esperando_horario",
            name: null,
            nss: null,
          });
          return exacto(MSG_MONTO_Y_HORARIO);
        },
        exacto(MSG_CREDITO_ACTIVO),
      );
    case "esperando_datos": {
      const digitosTexto = texto.replace(/\D/g, "");
      const textoTieneNssValido = digitosTexto.length === 11;
      const nss =
        textoTieneNssValido && entrada?.nss && /^\d{11}$/.test(entrada.nss)
          ? entrada.nss
          : extraerNssOnceDigitos(texto);
      if (!nss) {
        return exacto(MSG_NSS_INVALIDO);
      }

      const leadIdNss = await resolverLeadId(phone);
      const nssOk = await actualizarLeadPorConversacion(phone, { nss });
      if (!nssOk) {
        console.error("[lead] Error guardando NSS:", {
          phone,
          nss,
          lead_id: leadIdNss,
        });
      }

      await setConversation(phone, {
        state: "esperando_datos",
        name: null,
        nss: null,
      });
      datosPrecalificacionPorTelefono.delete(phone);
      console.log("[lead confirmado]", {
        phone,
        name: null,
        nss,
        lead_id: leadIdNss,
      });
      try {
        const resultado = await consultarPrecalificacionScraper(nss);
        const saldoSubcuenta = extraerSaldoSubcuenta(resultado);
        const saldoSubcuentaRaw = resultado.datos?.saldoSubcuenta;
        const montoCreditoRaw =
          resultado.datos?.montoCredito ?? resultado.montoCredito;
        const success = resultado.success === true || resultado.califica === true;
        if (success && saldoSubcuenta > 0 && saldoSubcuentaRaw !== undefined) {
          const datosPrecalificacion = {
            saldoSubcuentaRaw,
            saldoSubcuenta,
            montoCreditoRaw,
          };
          datosPrecalificacionPorTelefono.set(phone, datosPrecalificacion);
          const horario = horarioGuardadoEnConversacion(row.data);
          const leadIdMontos = await resolverLeadId(phone);
          const montosPayload = {
            saldo_subcuenta: saldoSubcuentaRaw,
            monto_base: saldoSubcuenta,
            monto_aprobado_min: saldoSubcuenta,
            monto_aprobado_max: saldoSubcuenta,
          };
          console.log("[lead] Actualizando montos:", {
            ...montosPayload,
            lead_id: leadIdMontos,
          });
          const montosOk = await actualizarLeadPorConversacion(phone, montosPayload);
          if (!montosOk) {
            console.error("[lead] Error guardando montos:", {
              phone,
              lead_id: leadIdMontos,
            });
          }
          await guardarLead(phone, nss, horario, datosPrecalificacion);
          datosPrecalificacionPorTelefono.delete(phone);
          await setConversation(phone, {
            state: "finalizado",
            name: null,
            nss: null,
          });
          const cierre = mensajeFinalizadoPost(horario);
          return exacto(`${mensajeMontoAutorizado(saldoSubcuenta)}\n\n${cierre}`);
        }

        if (resultado.success === false || resultado.califica === false) {
          return rechazar(phone, MSG_NO_CALIFICA_SCRAPER);
        }

        return exacto(MSG_REINTENTO_PRECIFICACION);
      } catch {
        return exacto(MSG_REINTENTO_PRECIFICACION);
      }
    }
    case "esperando_horario": {
      const horarioValido =
        entrada?.esHorarioValido === true || texto.length >= 3;
      if (!horarioValido) {
        return exacto(
          "¿Me compartes día y horario? Por ejemplo: martes 10 am.\n\n" +
            MSG_MONTO_Y_HORARIO,
        );
      }
      const leadIdHorario = await resolverLeadId(phone);
      console.log("[lead] Actualizando horario:", texto, "lead_id:", leadIdHorario);
      const horarioOk = await actualizarLeadPorConversacion(phone, { horario: texto });
      if (!horarioOk) {
        console.error("[lead] Error guardando horario:", {
          phone,
          horario: texto,
          lead_id: leadIdHorario,
        });
      }

      await setConversation(phone, {
        state: "esperando_datos",
        name: null,
        nss: null,
        data: { ...(row.data ?? {}), horario: texto },
      });
      return exacto(MSG_SOLICITUD_DATOS);
    }
    default:
      return await reiniciarFlujoCore(phone);
  }
}

export { esComandoReinicio };
