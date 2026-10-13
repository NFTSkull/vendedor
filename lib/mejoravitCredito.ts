export const TOPE_MONTO_MEJORAVIT = 169000;
export const FACTOR_NETO_MEJORAVIT = 0.9;

export type EstimacionCreditoMejoravit = {
  montoBase: number;
  montoTopado: number;
  montoNetoEstimado: number;
};

/** Estimación comercial sujeta a validación; no es una autorización oficial. */
export function estimarCreditoMejoravit(montoBase: number): EstimacionCreditoMejoravit {
  const base = Number.isFinite(montoBase) && montoBase > 0 ? montoBase : 0;
  const montoTopado = Math.min(base, TOPE_MONTO_MEJORAVIT);
  const montoNetoEstimado = Math.floor(montoTopado * FACTOR_NETO_MEJORAVIT);
  return { montoBase: base, montoTopado, montoNetoEstimado };
}
