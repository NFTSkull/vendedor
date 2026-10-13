export type EstadoVigenciaIne = "vigente" | "vencida" | "indeterminada";

export type ResultadoVigenciaIne = {
  estado: EstadoVigenciaIne;
  anioVencimiento: number | null;
};

const ANIO_MIN = 2000;
const ANIO_MAX = 2100;

/**
 * Evalúa el bloque "VIGENCIA" impreso en la INE ("2019 - 2029" o "2029").
 * El último año del bloque es el de vencimiento (el primero es emisión) y la credencial
 * vale hasta el 31 de diciembre de ese año. Si el texto no tiene un formato reconocido,
 * queda "indeterminada" para revisión: nunca se aprueba por omisión.
 */
export function evaluarVigenciaIne(
  bloqueVigencia: string | null | undefined,
  hoy: Date,
): ResultadoVigenciaIne {
  const indeterminada: ResultadoVigenciaIne = {
    estado: "indeterminada",
    anioVencimiento: null,
  };
  if (!bloqueVigencia) return indeterminada;

  const match = bloqueVigencia
    .trim()
    .toUpperCase()
    .match(/^(?:VIGENCIA\s*:?\s*)?(\d{4})(?:\s*[-–—]\s*(\d{4}))?$/);
  if (!match) return indeterminada;

  const primero = Number(match[1]);
  const segundo = match[2] ? Number(match[2]) : null;
  const anioVencimiento = segundo ?? primero;
  const fueraDeRango = (a: number) => a < ANIO_MIN || a > ANIO_MAX;
  if (fueraDeRango(primero) || (segundo !== null && fueraDeRango(segundo))) {
    return indeterminada;
  }
  if (segundo !== null && segundo < primero) return indeterminada;

  return {
    estado: hoy.getFullYear() <= anioVencimiento ? "vigente" : "vencida",
    anioVencimiento,
  };
}
