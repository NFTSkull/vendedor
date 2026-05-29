import {
  deleteConversation,
  getConversation,
  setConversation,
} from "@/lib/conversationMemory";
import {
  actualizarLeadPorConversacion,
  ensureLeadProvisional,
} from "@/lib/leadProvisional";
import { extraerNssOnceDigitos } from "@/lib/nss";
import { esAfirmativo, esComandoReinicio, esNegativo } from "@/lib/normalizeText";
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
  "Lo sentimos, este es un requisito indispensable para obtener el crédito.\n\n" +
  "Por el momento solo podemos continuar con personas que tengan una relación laboral vigente en Nuevo León.";

export const MSG_INFONAVIT =
  "¿Actualmente estás dado de alta en Infonavit?";

export const MSG_RECHAZO_INFONAVIT =
  "Lo sentimos, estar dado de alta en Infonavit es un requisito indispensable para obtener el crédito.";

export const MSG_CREDITO_ACTIVO =
  "¿Actualmente estas pagando un crédito Infonavit?";

export const MSG_RECHAZO_CREDITO_ACTIVO =
  "Es necesario que termines de pagar tu crédito Infonavit actual para poder continuar con este trámite.";

export const MSG_SOLICITUD_DATOS =
  "Compárteme tu Número de Seguro Social (NSS) para darte el monto autorizado.";

export const MSG_MONTO_Y_HORARIO =
  "Tu monto autorizado es aproximadamente de ___\n\n" +
  "¿En qué día y horario te podemos contactar para darte más detalles?";

export const MSG_FINAL =
  "Gracias. Un asesor se pondrá en contacto contigo en el horario que nos indicaste.\n\n" +
  "También puedes comunicarte directamente a este número:\n\n" +
  "8140100246";

const MSG_NSS_INVALIDO =
  "Necesito un número de seguro social (IMSS) de 11 dígitos. Intenta de nuevo.\n\n" +
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
  montoBase: number;
  montoAprobadoMin: number;
  montoAprobadoMax: number;
};

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

async function rechazar(phone: string, mensaje: string): Promise<ResultadoPaso> {
  datosPrecalificacionPorTelefono.delete(phone);
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
    leadPayload.monto_base = datosPrecalificacion.montoBase;
    leadPayload.monto_aprobado_min = datosPrecalificacion.montoAprobadoMin;
    leadPayload.monto_aprobado_max = datosPrecalificacion.montoAprobadoMax;
  }

  const conv = await getConversation(phone);
  if (!conv.lead_id) {
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("leads")
        .insert({
          whatsapp_phone: phone,
          ...leadPayload,
        })
        .select("id")
        .single();

      if (error || !data?.id) {
        console.error("[Supabase] Error guardando lead (fallback insert):", {
          phone,
          nss,
          horario,
          error,
        });
        return;
      }

      await setConversation(phone, {
        state: conv.state,
        lead_id: data.id,
      });
      console.log("[Supabase] Lead guardado (fallback insert):", { phone, nss, horario });
      return;
    } catch (err) {
      console.error("[Supabase] Error guardando lead (fallback insert):", err);
      return;
    }
  }

  const ok = await actualizarLeadPorConversacion(phone, leadPayload);
  if (!ok) {
    console.error("[Supabase] Error actualizando lead:", { phone, nss, horario });
  } else {
    console.log("[Supabase] Lead actualizado:", { phone, nss, horario });
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

  switch (state) {
    case "finalizado": {
      return { texto: "__POST_FLUJO__", exacto: true };
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
      const nss =
        textoTieneNssValido && entrada?.nss && /^\d{11}$/.test(entrada.nss)
          ? entrada.nss
          : extraerNssOnceDigitos(texto);
      if (!nss) {
        return exacto(MSG_NSS_INVALIDO);
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
      });
      try {
        const resultado = await consultarPrecalificacionScraper(nss);
        const saldoSubcuentaRaw = resultado.datos?.saldoSubcuenta;
        const saldoSubcuenta = parseNumero(saldoSubcuentaRaw);
        const success = resultado.success === true || resultado.califica === true;
        if (
          success &&
          saldoSubcuenta > 0 &&
          (typeof saldoSubcuentaRaw === "number" || typeof saldoSubcuentaRaw === "string")
        ) {
          const montoBase = Math.floor(saldoSubcuenta * 0.9);
          const min = Math.floor(saldoSubcuenta * 0.9 * 0.8);
          const max = Math.floor((saldoSubcuenta * 0.9) / 0.85);
          datosPrecalificacionPorTelefono.set(phone, {
            saldoSubcuentaRaw,
            montoBase,
            montoAprobadoMin: min,
            montoAprobadoMax: max,
          });
          await actualizarLeadPorConversacion(phone, { nss });
          await setConversation(phone, {
            state: "esperando_horario",
            name: null,
            nss,
          });
          return exacto(
            `Tu monto autorizado es aproximadamente de:\n${formatMoneda(min)} a ${formatMoneda(max)} 🏠\n¿En qué día y horario te podemos contactar?`,
          );
        }

        if (resultado.success === false || resultado.califica === false) {
          return exacto(
            "Lo sentimos, en este momento no calificas para el crédito Mejoravit. Si tienes dudas, uno de nuestros asesores puede orientarte. ¿Te gustaría que te contactemos?",
          );
        }

        return exacto(
          "Tuvimos un problema consultando tu información. ¿Puedes intentarlo de nuevo en unos minutos?",
        );
      } catch {
        return exacto(
          "Tuvimos un problema consultando tu información. ¿Puedes intentarlo de nuevo en unos minutos?",
        );
      }
    }
    case "esperando_horario": {
      if (!row.nss) {
        return await reiniciarFlujoCore(phone);
      }
      const horarioValido =
        entrada?.esHorarioValido === true || texto.length >= 3;
      if (!horarioValido) {
        return exacto(
          "¿Me compartes día y horario? Por ejemplo: martes 10 am.\n\n" +
            MSG_MONTO_Y_HORARIO,
        );
      }
      const datosPrecalificacion = datosPrecalificacionPorTelefono.get(phone);
      await guardarLead(phone, row.nss, texto, datosPrecalificacion);
      datosPrecalificacionPorTelefono.delete(phone);

      await setConversation(phone, {
        state: "finalizado",
        name: null,
        nss: null,
      });
      return exacto(MSG_FINAL);
    }
    default:
      return await reiniciarFlujoCore(phone);
  }
}

export { esComandoReinicio };
