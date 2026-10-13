/**
 * Datos de identidad y laborales que `mejoravit-scraper` devuelve en la raíz de
 * POST /precalificar. `empresa` y `registroPatronal` solo llegan con `califica: true`
 * y pueden ser null (crédito activo, RFC sin homoclave, timeout del paso de inscripción).
 */
export type DatosPortalPrecalificacion = {
  nombre: string | null;
  rfc: string | null;
  rfcConHomoclave: boolean;
  empresa: string | null;
  registroPatronal: string | null;
};

const ETIQUETAS_PORTAL = /^(N\.?\s*R\.?\s*P\.?|N\.?\s*S\.?\s*S\.?|R\.?\s*F\.?\s*C\.?)\s*:?$/i;
const REGEX_RFC_FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z\d]{3}$/;

function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio || null;
}

export function normalizarRegistroPatronal(valor: unknown): string | null {
  const t = texto(valor);
  if (!t) return null;
  const nrp = t.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{11}$/.test(nrp) && /\d/.test(nrp) ? nrp : null;
}

export function normalizarEmpresa(valor: unknown): string | null {
  const t = texto(valor);
  if (!t || t.length < 2 || ETIQUETAS_PORTAL.test(t) || /^\d+$/.test(t)) return null;
  return t;
}

export function extraerDatosPortal(resultado: unknown): DatosPortalPrecalificacion {
  const r =
    resultado && typeof resultado === "object"
      ? (resultado as Record<string, unknown>)
      : {};
  const rfc = texto(r.rfc)?.toUpperCase().replace(/\s/g, "") ?? null;
  const advertencia = texto(r.advertenciaInscripcion)?.toLowerCase() ?? "";
  return {
    nombre: texto(r.nombre),
    rfc,
    rfcConHomoclave:
      rfc !== null && REGEX_RFC_FISICA.test(rfc) && !advertencia.includes("homoclave"),
    empresa: normalizarEmpresa(r.empresa),
    registroPatronal: normalizarRegistroPatronal(r.registroPatronal),
  };
}
