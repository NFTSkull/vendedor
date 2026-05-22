export type ResultadoPrecalificacionApi = {
  califica: boolean;
  nombre?: string;
  nss?: string;
  mensaje?: string;
  datos?: {
    saldoSubcuenta?: number | string;
    capacidadCompra?: number | string;
    pagoMensual?: number | string;
  };
};

const MOTIVOS_RECHAZO: Record<string, string> = {
  "SIN RELACION LABORAL VIGENTE":
    "Sin relación laboral vigente",
  "SIN APORTACIONES": "Sin aportaciones activas",
  "NO CUMPLE": "No cumple requisitos mínimos",
  BAJA: "Registro en baja en Infonavit",
};

export function normalizarNumero(
  value: number | string | null | undefined,
): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") return 0;
  const limpio = value.replace(/[^0-9.]/g, "");
  const num = Number(limpio);
  return Number.isFinite(num) ? num : 0;
}

export function formatearMoneda(value: number): string {
  return `$${Math.floor(value).toLocaleString("es-MX")}`;
}

export function calcularRangoAprobado(saldoSubcuenta: number): {
  min: number;
  max: number;
} {
  const montoPrestable = saldoSubcuenta * 0.9;
  return {
    min: Math.floor(montoPrestable * 0.8),
    max: Math.floor(montoPrestable * 0.85),
  };
}

export function motivoRechazoLegible(codigo: string | undefined): string {
  if (!codigo) return "No fue posible completar la precalificación";
  return MOTIVOS_RECHAZO[codigo] ?? codigo;
}

export function nssValido(nss: string): boolean {
  return nss.replace(/\D/g, "").length === 11;
}

export function nssSoloDigitos(nss: string): string {
  return nss.replace(/\D/g, "").slice(0, 11);
}
