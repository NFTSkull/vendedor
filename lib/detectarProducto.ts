export type ProductoLead =
  | "mejoravit"
  | "paneles"
  | "generadores"
  | "sin_clasificar";

/** Número bot principal Mejoravit (+52 81 1411 8767) */
export const MEJORAVIT_PHONE_NUMBER_ID = "1177472778778882";

/** Placeholder hasta confirmar phone_number_id de Energrum */
export const ENERGRUM_PHONE_NUMBER_ID = "ENERGRUM_PENDING";

// === OVERRIDE TEMPORAL: Concasa reutilizado para Generadores ===
// Para revertir a Mejoravit: borra esta constante y el bloque if asociado.
export const CONCASA_GENERADORES_PHONE_NUMBER_ID = "1105059976021942";

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

  // OVERRIDE TEMPORAL — borrar para devolver el número a Mejoravit
  if (phoneNumberId === CONCASA_GENERADORES_PHONE_NUMBER_ID) {
    return "generadores";
  }

  if (phoneNumberId === ENERGRUM_PHONE_NUMBER_ID) {
    return clasificarMensajeEnergrum(args.primerMensaje);
  }

  return "mejoravit";
}

/** IDs de asesores en Supabase (override con ADVISOR_ID_GUILLERMO / ADVISOR_ID_BERNARDO) */
export const ADVISOR_ID_GUILLERMO =
  process.env.ADVISOR_ID_GUILLERMO?.trim() ||
  "2d46ad6c-dc1a-4089-81ec-47eb0be7472e";

export const ADVISOR_ID_BERNARDO =
  process.env.ADVISOR_ID_BERNARDO?.trim() ||
  "cf72eace-68a2-457b-b0cc-f30c51bca7aa";

export type ResultadoPrefijoAsesor = {
  advisorId: string | null;
  textoLimpio: string;
};

/**
 * Detecta prefijo G-/B- al inicio del primer mensaje (estado inicio).
 * Quita el prefijo del texto para que el bot no lo procese.
 */
export function detectarPrefijoAsesor(texto: string): ResultadoPrefijoAsesor {
  const trimmed = texto.trimStart();
  const match = trimmed.match(/^([GgBb])-([\s\S]*)$/);
  if (!match) {
    return { advisorId: null, textoLimpio: texto };
  }

  const prefijo = match[1].toLowerCase();
  const resto = match[2].trim();
  const advisorId =
    prefijo === "g"
      ? ADVISOR_ID_GUILLERMO
      : prefijo === "b"
        ? ADVISOR_ID_BERNARDO
        : null;

  return {
    advisorId,
    textoLimpio:
      resto.length > 0 ? resto : advisorId ? "" : texto.trim(),
  };
}
