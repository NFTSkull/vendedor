import { conversationMemory } from "@/lib/conversationMemory";
import { extraerNssOnceDigitos } from "@/lib/nss";
import { esAfirmativo, esComandoReinicio, esNegativo } from "@/lib/normalizeText";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type BotState =
  | "inicio"
  | "esperando_labor_vigente"
  | "esperando_infonavit"
  | "esperando_credito_activo"
  | "esperando_centro_trabajo"
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
  "¿Tienes un crédito Infonavit activo?";

export const MSG_RECHAZO_CREDITO_ACTIVO =
  "Es necesario que termines de pagar tu crédito Infonavit actual para poder continuar con este trámite.";

export const MSG_CENTRO_TRABAJO =
  "¿Tu centro de trabajo está en Nuevo León?";

export const MSG_RECHAZO_CENTRO_TRABAJO =
  "Lo sentimos, este es un requisito indispensable para obtener el crédito.\n\n" +
  "Actualmente este apoyo está disponible solo para Nuevo León.";

export const MSG_SOLICITUD_DATOS =
  "Compárteme tu Número de Seguro Social (NSS) para darte el monto autorizado.";

export const MSG_MONTO_Y_HORARIO =
  "Tu monto autorizado es aproximadamente de ___\n\n" +
  "¿En qué día y horario te podemos contactar para darte más detalles?";

export const MSG_FINAL =
  "Gracias. Un asesor se pondrá en contacto contigo en el horario que nos indicaste.\n\n" +
  "También puedes comunicarte directamente a estos números:\n\n" +
  "8114118767\n" +
  "8140100246";

const MSG_NSS_INVALIDO =
  "Necesito un número de seguro social (IMSS) de 11 dígitos. Intenta de nuevo.\n\n" +
  MSG_SOLICITUD_DATOS;

export function preguntaDelEstado(state: BotState): string {
  switch (state) {
    case "esperando_labor_vigente":
      return MSG_BIENVENIDA;
    case "esperando_infonavit":
      return MSG_INFONAVIT;
    case "esperando_credito_activo":
      return MSG_CREDITO_ACTIVO;
    case "esperando_centro_trabajo":
      return MSG_CENTRO_TRABAJO;
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
    state === "esperando_credito_activo" ||
    state === "esperando_centro_trabajo"
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

function rechazar(phone: string, mensaje: string): ResultadoPaso {
  conversationMemory.set(phone, {
    state: "finalizado",
    name: null,
    nss: null,
  });
  return exacto(mensaje);
}

function responderSiNoCore(
  texto: string,
  entrada: EntradaInterpretada | undefined,
  onSi: () => ResultadoPaso,
  onNo: () => ResultadoPaso,
  reintento: ResultadoPaso,
): ResultadoPaso {
  if (entrada?.esSi) return onSi();
  if (entrada?.esNo) return onNo();
  if (esAfirmativo(texto)) return onSi();
  if (esNegativo(texto)) return onNo();
  return reintento;
}

async function guardarLead(phone: string, nss: string, horario: string) {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("leads")
      .insert({ whatsapp_phone: phone, nss, horario, estado: "nuevo" });

    if (error) console.error("[Supabase] Error guardando lead:", error);
    else console.log("[Supabase] Lead guardado:", { phone, nss, horario });
  } catch (err) {
    console.error("[Supabase] Error:", err);
  }
}

export function reiniciarFlujoCore(phone: string): ResultadoPaso {
  conversationMemory.delete(phone);
  conversationMemory.set(phone, {
    state: "esperando_labor_vigente",
    name: null,
    nss: null,
  });
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
  const row = conversationMemory.get(phone);
  const state = (row?.state ?? "inicio") as BotState;

  switch (state) {
    case "finalizado":
      return reiniciarFlujoCore(phone);
    case "inicio":
      conversationMemory.set(phone, {
        state: "esperando_labor_vigente",
        name: null,
        nss: null,
      });
      return exacto(MSG_BIENVENIDA);
    case "esperando_labor_vigente":
      return responderSiNoCore(
        texto,
        entrada,
        () => {
          conversationMemory.set(phone, {
            state: "esperando_infonavit",
            name: null,
            nss: null,
          });
          return exacto(MSG_INFONAVIT);
        },
        () => rechazar(phone, MSG_RECHAZO_LABOR),
        exacto(MSG_BIENVENIDA),
      );
    case "esperando_infonavit":
      return responderSiNoCore(
        texto,
        entrada,
        () => {
          conversationMemory.set(phone, {
            state: "esperando_credito_activo",
            name: null,
            nss: null,
          });
          return exacto(MSG_CREDITO_ACTIVO);
        },
        () => rechazar(phone, MSG_RECHAZO_INFONAVIT),
        exacto(MSG_INFONAVIT),
      );
    case "esperando_credito_activo":
      return responderSiNoCore(
        texto,
        entrada,
        () => rechazar(phone, MSG_RECHAZO_CREDITO_ACTIVO),
        () => {
          conversationMemory.set(phone, {
            state: "esperando_centro_trabajo",
            name: null,
            nss: null,
          });
          return exacto(MSG_CENTRO_TRABAJO);
        },
        exacto(MSG_CREDITO_ACTIVO),
      );
    case "esperando_centro_trabajo":
      return responderSiNoCore(
        texto,
        entrada,
        () => {
          conversationMemory.set(phone, {
            state: "esperando_datos",
            name: null,
            nss: null,
          });
          return exacto(MSG_SOLICITUD_DATOS);
        },
        () => rechazar(phone, MSG_RECHAZO_CENTRO_TRABAJO),
        exacto(MSG_CENTRO_TRABAJO),
      );
    case "esperando_datos": {
      const nss =
        entrada?.nss && /^\d{11}$/.test(entrada.nss)
          ? entrada.nss
          : extraerNssOnceDigitos(texto);
      if (!nss) {
        return exacto(MSG_NSS_INVALIDO);
      }
      conversationMemory.set(phone, {
        state: "esperando_horario",
        name: null,
        nss,
      });
      console.log("[lead confirmado]", {
        phone,
        name: null,
        nss,
      });
      return exacto(MSG_MONTO_Y_HORARIO);
    }
    case "esperando_horario": {
      if (!row?.nss) {
        return reiniciarFlujoCore(phone);
      }
      const horarioValido =
        entrada?.esHorarioValido === true || texto.length >= 3;
      if (!horarioValido) {
        return exacto(
          "¿Me compartes día y horario? Por ejemplo: martes 10 am.\n\n" +
            MSG_MONTO_Y_HORARIO,
        );
      }
      await guardarLead(phone, row.nss, texto);

      conversationMemory.set(phone, {
        state: "finalizado",
        name: null,
        nss: null,
      });
      return exacto(MSG_FINAL);
    }
    default:
      return reiniciarFlujoCore(phone);
  }
}

export { esComandoReinicio };
