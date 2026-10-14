export type ProductoLead =
  | "mejoravit"
  | "paneles"
  | "generadores"
  | "compra_casa"
  | "sin_clasificar";

/**
 * Número bot principal (+52 81 1411 8767). Atiende Mejoravit, Compra de Casa y Generadores:
 * el producto lo decide el anuncio o el primer mensaje, no el número.
 */
export const NUMERO_COMPARTIDO_PHONE_NUMBER_ID = "1177472778778882";

/** Placeholder hasta confirmar phone_number_id de Energrum */
export const ENERGRUM_PHONE_NUMBER_ID = "ENERGRUM_PENDING";

export type ProductoForzado = Extract<ProductoLead, "mejoravit" | "compra_casa">;

/** Datos del anuncio de Meta (click-to-WhatsApp) que llegan en `messages[].referral`. */
export type ReferralAnuncio = {
  headline?: string | null;
  body?: string | null;
  sourceUrl?: string | null;
};

/** Producto fijado por comando en `conversations.data.productoForzado`; tiene prioridad sobre la clasificación automática. */
export function productoForzadoDe(
  data: Record<string, unknown> | undefined,
): ProductoForzado | null {
  const valor = data?.productoForzado;
  return valor === "mejoravit" || valor === "compra_casa" ? valor : null;
}

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

type ProductoNumeroCompartido = Extract<
  ProductoLead,
  "mejoravit" | "compra_casa" | "generadores"
>;

type ReglasPalabras = Record<ProductoNumeroCompartido, RegExp[]>;

/**
 * Frases estrictas del primer mensaje. "infonavit" suelto no cuenta: aparece en nombres de
 * colonias ("Infonavit Las Puentes") de clientes que vienen por otro producto.
 */
const PALABRAS_PRIMER_MENSAJE: ReglasPalabras = {
  mejoravit: [
    /\bmejoravit\b/,
    /\bnss\b/,
    /\bcredito (?:de |del )?infonavit\b/,
    /\bprestamos?\b/,
  ],
  compra_casa: [
    /\bvender\b/,
    /\bvendo mi (?:casa|propiedad|depa|departamento)\b/,
    /\bventa de mi (?:casa|propiedad|depa|departamento)\b/,
  ],
  generadores: [/\bgeneradore?s?\b/, /\bvacantes?\b/],
};

/** El texto del anuncio lo redacta el negocio, por eso admite términos más amplios. */
const PALABRAS_ANUNCIO: ReglasPalabras = {
  mejoravit: [...PALABRAS_PRIMER_MENSAJE.mejoravit, /\binfonavit\b/],
  compra_casa: [
    ...PALABRAS_PRIMER_MENSAJE.compra_casa,
    /\bvende\b/,
    /\bventa\b/,
    /\bcompramos tu (?:casa|propiedad)\b/,
  ],
  generadores: PALABRAS_PRIMER_MENSAJE.generadores,
};

function normalizarParaPalabras(texto: string): string {
  return normalizarTexto(texto)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Un solo producto con coincidencia → ese producto; ninguno o varios → null (ambiguo). */
function productoPorPalabras(
  texto: string,
  reglas: ReglasPalabras,
): ProductoNumeroCompartido | null {
  const normalizado = normalizarParaPalabras(texto);
  if (!normalizado) return null;
  const coincidencias = (Object.keys(reglas) as ProductoNumeroCompartido[]).filter(
    (producto) => reglas[producto].some((regla) => regla.test(normalizado)),
  );
  return coincidencias.length === 1 ? coincidencias[0] : null;
}

/** Cascada del número compartido: anuncio de Meta → palabras clave del mensaje → sin_clasificar. */
export function clasificarNumeroCompartido(args: {
  primerMensaje: string;
  referral?: ReferralAnuncio | null;
}): ProductoLead {
  const referral = args.referral;
  if (referral) {
    const textoAnuncio = [referral.headline, referral.body, referral.sourceUrl]
      .filter((parte): parte is string => typeof parte === "string")
      .join(" ");
    const porAnuncio = productoPorPalabras(textoAnuncio, PALABRAS_ANUNCIO);
    if (porAnuncio) return porAnuncio;
  }

  return productoPorPalabras(args.primerMensaje, PALABRAS_PRIMER_MENSAJE) ?? "sin_clasificar";
}

/**
 * Asigna producto al crear o ligar un lead.
 * phoneNumberId desconocido → mejoravit (fallback seguro).
 */
export function detectarProducto(args: {
  phoneNumberId: string;
  primerMensaje: string;
  referral?: ReferralAnuncio | null;
}): ProductoLead {
  const phoneNumberId = args.phoneNumberId.trim();

  if (phoneNumberId === NUMERO_COMPARTIDO_PHONE_NUMBER_ID) {
    return clasificarNumeroCompartido({
      primerMensaje: args.primerMensaje,
      referral: args.referral,
    });
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

/** Admin CRM (leads sin advisor_id); override con ADVISOR_ID_ADMIN */
export const ADVISOR_ID_ADMIN =
  process.env.ADVISOR_ID_ADMIN?.trim() ||
  "0115fcee-703b-47c6-9c68-acd6eca1aa1a";

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
