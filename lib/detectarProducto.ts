export type ProductoLead =
  | "mejoravit"
  | "paneles"
  | "generadores"
  | "sin_clasificar";

/** Número bot principal Mejoravit (+52 81 1411 8767) */
export const MEJORAVIT_PHONE_NUMBER_ID = "1177472778778882";

/** Placeholder hasta confirmar phone_number_id de Energrum */
export const ENERGRUM_PHONE_NUMBER_ID = "ENERGRUM_PENDING";

function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function clasificarMensajeEnergrum(primerMensaje: string): ProductoLead {
  const texto = normalizarTexto(primerMensaje.trim());

  if (texto.includes("panel") || texto.includes("solar")) {
    return "paneles";
  }

  if (texto.includes("generador")) {
    return "generadores";
  }

  return "sin_clasificar";
}

/**
 * Asigna producto al crear un lead. Solo debe invocarse una vez por lead nuevo.
 * phoneNumberId desconocido → mejoravit (fallback seguro).
 */
export function detectarProducto(args: {
  phoneNumberId: string;
  primerMensaje: string;
}): ProductoLead {
  const phoneNumberId = args.phoneNumberId.trim();

  if (phoneNumberId === MEJORAVIT_PHONE_NUMBER_ID) {
    return "mejoravit";
  }

  if (phoneNumberId === ENERGRUM_PHONE_NUMBER_ID) {
    return clasificarMensajeEnergrum(args.primerMensaje);
  }

  return "mejoravit";
}
