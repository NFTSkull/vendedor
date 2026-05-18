import { conversationMemory } from "@/lib/conversationMemory";
import { extraerNssOnceDigitos } from "@/lib/nss";
import { esAfirmativo, esNegativo } from "@/lib/normalizeText";

export type BotState =
  | "inicio"
  | "esperando_labor_vigente"
  | "esperando_infonavit"
  | "esperando_credito_activo"
  | "esperando_centro_trabajo"
  | "esperando_datos"
  | "post_monto"
  | "esperando_interes"
  | "esperando_horario"
  | "finalizado";

const MSG_BIENVENIDA =
  "Buenas tardes, gracias por contactarnos.\n\n" +
  "¿Actualmente tienes una relación laboral vigente en Nuevo León?\n\n" +
  "Responde:\n" +
  "Sí\n" +
  "No";

const MSG_RECHAZO_LABOR =
  "Lo sentimos, este es un requisito indispensable para obtener el crédito.\n\n" +
  "Por el momento solo podemos continuar con personas que tengan una relación laboral vigente en Nuevo León.";

const MSG_INFONAVIT =
  "¿Actualmente estás dado de alta en Infonavit?\n\n" +
  "Responde:\n" +
  "Sí\n" +
  "No";

const MSG_RECHAZO_INFONAVIT =
  "Lo sentimos, estar dado de alta en Infonavit es un requisito indispensable para obtener el crédito.";

const MSG_CREDITO_ACTIVO =
  "¿Tienes un crédito Infonavit activo?\n\n" +
  "Responde:\n" +
  "Sí\n" +
  "No";

const MSG_RECHAZO_CREDITO_ACTIVO =
  "Es necesario que termines de pagar tu crédito Infonavit actual para poder continuar con este trámite.";

const MSG_CENTRO_TRABAJO =
  "¿Tu centro de trabajo está en Nuevo León?\n\n" +
  "Responde:\n" +
  "Sí\n" +
  "No";

const MSG_RECHAZO_CENTRO_TRABAJO =
  "Lo sentimos, este es un requisito indispensable para obtener el crédito.\n\n" +
  "Actualmente este apoyo está disponible solo para Nuevo León.";

const MSG_SOLICITUD_DATOS =
  "Perfecto.\n\n" +
  "Compárteme tu nombre completo y tu Número de Seguro Social para revisar tu monto autorizado aproximado.";

const MSG_MONTO_APROXIMADO =
  "Gracias.\n\n" +
  "Tu monto autorizado aproximado es de: __________\n\n" +
  "Este monto puede variar según la validación final de tu información.";

const MSG_INTERES =
  "¿Te interesa continuar con el trámite?\n\n" +
  "Responde:\n" +
  "Sí\n" +
  "No";

const MSG_RECHAZO_INTERES =
  "Entendido, gracias por contactarnos.\n\n" +
  "Si más adelante deseas revisar tu crédito autorizado, puedes escribirnos nuevamente.";

const MSG_HORARIO =
  "Excelente.\n\n" +
  "¿En qué día y horario te podemos contactar para darte más detalles de tu trámite?";

const MSG_FINAL =
  "Gracias. Un asesor se pondrá en contacto contigo en el horario que nos indicaste.\n\n" +
  "También puedes comunicarte directamente a estos números:\n\n" +
  "8114118767\n" +
  "8140100246";

function snapshotInicial(phone: string): {
  state: BotState;
  name: string | null;
  nss: string | null;
} {
  const row = conversationMemory.get(phone);
  if (!row) {
    return { state: "inicio", name: null, nss: null };
  }
  return {
    state: row.state as BotState,
    name: row.name,
    nss: row.nss,
  };
}

function guardar(
  phone: string,
  state: BotState,
  name: string | null,
  nss: string | null,
): void {
  conversationMemory.set(phone, { state, name, nss });
}

function rechazar(phone: string, mensaje: string): string {
  guardar(phone, "finalizado", null, null);
  return mensaje;
}

function responderSiNo(
  texto: string,
  onSi: () => string,
  onNo: () => string,
  reintento: string,
): string | null {
  if (esAfirmativo(texto)) return onSi();
  if (esNegativo(texto)) return onNo();
  return reintento;
}

function extraerNombreYNss(texto: string): { nombre: string; nss: string } | null {
  const nss = extraerNssOnceDigitos(texto);
  if (!nss) return null;

  const nombre = texto
    .replace(/\d/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!nombre) return null;
  return { nombre, nss };
}

/**
 * Evoluciona el estado en memoria y devuelve el texto a enviar al usuario.
 */
export function procesarYEvolucionar(args: {
  phone: string;
  textoUsuario: string;
}): string | null {
  const texto = args.textoUsuario.trim();
  if (!texto) return null;

  const phone = args.phone;
  const prev = snapshotInicial(phone);

  switch (prev.state) {
    case "finalizado":
      return iniciarCycle(phone);
    case "inicio":
      guardar(phone, "esperando_labor_vigente", null, null);
      return MSG_BIENVENIDA;
    case "esperando_labor_vigente":
      return (
        responderSiNo(
          texto,
          () => {
            guardar(phone, "esperando_infonavit", null, null);
            return MSG_INFONAVIT;
          },
          () => rechazar(phone, MSG_RECHAZO_LABOR),
          MSG_BIENVENIDA,
        ) ?? MSG_BIENVENIDA
      );
    case "esperando_infonavit":
      return (
        responderSiNo(
          texto,
          () => {
            guardar(phone, "esperando_credito_activo", null, null);
            return MSG_CREDITO_ACTIVO;
          },
          () => rechazar(phone, MSG_RECHAZO_INFONAVIT),
          MSG_INFONAVIT,
        ) ?? MSG_INFONAVIT
      );
    case "esperando_credito_activo":
      return (
        responderSiNo(
          texto,
          () => rechazar(phone, MSG_RECHAZO_CREDITO_ACTIVO),
          () => {
            guardar(phone, "esperando_centro_trabajo", null, null);
            return MSG_CENTRO_TRABAJO;
          },
          MSG_CREDITO_ACTIVO,
        ) ?? MSG_CREDITO_ACTIVO
      );
    case "esperando_centro_trabajo":
      return (
        responderSiNo(
          texto,
          () => {
            guardar(phone, "esperando_datos", null, null);
            return MSG_SOLICITUD_DATOS;
          },
          () => rechazar(phone, MSG_RECHAZO_CENTRO_TRABAJO),
          MSG_CENTRO_TRABAJO,
        ) ?? MSG_CENTRO_TRABAJO
      );
    case "esperando_datos": {
      const datos = extraerNombreYNss(texto);
      if (!datos) {
        return (
          "Necesito tu nombre completo y un Número de Seguro Social de 11 dígitos. " +
          "Intenta de nuevo.\n\n" +
          MSG_SOLICITUD_DATOS
        );
      }
      guardar(phone, "post_monto", datos.nombre, datos.nss);
      console.log("[lead confirmado]", {
        phone,
        name: datos.nombre,
        nss: datos.nss,
      });
      return MSG_MONTO_APROXIMADO;
    }
    case "post_monto": {
      guardar(phone, "esperando_interes", prev.name, prev.nss);
      return MSG_INTERES;
    }
    case "esperando_interes":
      return (
        responderSiNo(
          texto,
          () => {
            guardar(phone, "esperando_horario", prev.name, prev.nss);
            return MSG_HORARIO;
          },
          () => rechazar(phone, MSG_RECHAZO_INTERES),
          MSG_INTERES,
        ) ?? MSG_INTERES
      );
    case "esperando_horario": {
      if (!prev.name || !prev.nss) {
        return iniciarCycle(phone);
      }
      console.log("[lead horario]", {
        phone,
        name: prev.name,
        nss: prev.nss,
        horario: texto,
      });
      guardar(phone, "finalizado", null, null);
      return MSG_FINAL;
    }
    default:
      return iniciarCycle(phone);
  }
}

function iniciarCycle(phone: string): string {
  guardar(phone, "esperando_labor_vigente", null, null);
  return MSG_BIENVENIDA;
}
