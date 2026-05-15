import { conversationMemory } from "@/lib/conversationMemory";
import { extraerNssOnceDigitos } from "@/lib/nss";
import { esAfirmativo, esNegativo } from "@/lib/normalizeText";

export type BotState =
  | "inicio"
  | "esperando_nombre"
  | "esperando_nss"
  | "confirmando"
  | "finalizado";

const MSG_HOLA =
  "¡Hola! Soy el asistente de Mejoravit. " +
  "Para consultar tu crédito Infonavit, ¿puedes decirme tu nombre completo?";

const MSG_ASESOR =
  "Listo, un asesor revisará tu información y te contactará pronto.";

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
      guardar(phone, "esperando_nombre", null, null);
      return MSG_HOLA;
    case "esperando_nombre": {
      const nombre = texto;
      guardar(phone, "esperando_nss", nombre, prev.nss);
      return `Gracias ${nombre}. Ahora necesito tu Número de Seguro Social (NSS) de 11 dígitos.`;
    }
    case "esperando_nss": {
      const nssOk = extraerNssOnceDigitos(texto);
      if (!nssOk) {
        return "El NSS debe tener exactamente 11 dígitos, intenta de nuevo.";
      }
      guardar(phone, "confirmando", prev.name, nssOk);
      return `Perfecto. Confirma tus datos: Nombre: ${prev.name} / NSS: ${nssOk} ¿Es correcto? Responde Sí o No.`;
    }
    case "confirmando":
      return manejarConfirmacion(phone, texto, prev);
    default:
      return iniciarCycle(phone);
  }
}

function manejarConfirmacion(
  phone: string,
  texto: string,
  prev: { state: BotState; name: string | null; nss: string | null },
): string {
  if (esAfirmativo(texto)) {
    if (!prev.name || !prev.nss) {
      return iniciarFresh(phone);
    }
    console.log("[lead confirmado]", {
      phone,
      name: prev.name,
      nss: prev.nss,
    });
    guardar(phone, "finalizado", null, null);
    return MSG_ASESOR;
  }

  if (esNegativo(texto)) return iniciarFresh(phone);

  return "¿Es correcto? Responde Sí o No.";
}

function iniciarFresh(phone: string): string {
  guardar(phone, "esperando_nombre", null, null);
  return MSG_HOLA;
}

function iniciarCycle(phone: string): string {
  guardar(phone, "esperando_nombre", null, null);
  return MSG_HOLA;
}
