/** Columnas que usa la pantalla de detalle del lead (`app/crm/leads/[id]/page.tsx`). */
export const COLUMNAS_LEAD_DETALLE =
  "id, whatsapp_phone, nss, horario, estado, created_at, updated_at, producto, nota, fecha_contacto, " +
  "precalificacion_status, precalificacion_resultado, precalificado_at, nombre_infonavit, saldo_subcuenta, " +
  "monto_base, monto_aprobado_min, monto_aprobado_max, capacidad_compra, pago_mensual";

type ResultadoGuardado = {
  califica?: unknown;
  mensaje?: unknown;
  datos?: { saldoSubcuenta?: unknown } | null;
} | null;

/**
 * De la respuesta del portal solo se exponen el motivo y el saldo que muestra la pantalla;
 * RFC, empresa, registro patronal y demás datos del portal no salen del servidor.
 */
export function leadDetalleParaCrm(lead: Record<string, unknown>): Record<string, unknown> {
  const resultado = lead.precalificacion_resultado as ResultadoGuardado;
  return {
    ...lead,
    precalificacion_resultado:
      resultado && typeof resultado === "object"
        ? {
            califica: resultado.califica,
            mensaje: resultado.mensaje,
            datos: { saldoSubcuenta: resultado.datos?.saldoSubcuenta },
          }
        : null,
  };
}
