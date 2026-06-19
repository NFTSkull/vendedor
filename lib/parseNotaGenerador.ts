export type NotaGeneradorParseada =
  | { tipo: "parseado"; uso: string; equipos: string }
  | { tipo: "cruda"; nota: string };

/** Leads sin producto se tratan como Mejoravit (compatibilidad). */
export function esMejoravitLead(producto?: string | null): boolean {
  return producto == null || producto === "mejoravit";
}

export function esGeneradoresLead(producto?: string | null): boolean {
  return producto === "generadores";
}

export function urlWhatsAppLead(whatsappPhone: string): string {
  const digits = whatsappPhone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

const REGEX_NOTA_GENERADOR =
  /Uso:\s*(.+?)\.\s*Equipos a respaldar:\s*(.+?)\.?$/i;

export function parsearNotaGenerador(
  nota: string | null | undefined,
): NotaGeneradorParseada | null {
  const raw = nota?.trim();
  if (!raw) return null;

  const match = raw.match(REGEX_NOTA_GENERADOR);
  if (!match) {
    return { tipo: "cruda", nota: raw };
  }

  return {
    tipo: "parseado",
    uso: match[1].trim(),
    equipos: match[2].trim(),
  };
}

export function valorGeneradorDisplay(valor: string): string {
  return valor.trim() || "Sin dato";
}
