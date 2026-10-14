import { ADVISOR_ID_GUILLERMO, type ProductoLead } from "@/lib/detectarProducto";

/** Lee las variables en cada llamada, no al cargar el módulo, para poder sobrescribirlas en tests. */
export function asesorPorDefecto(producto: ProductoLead): string | null {
  if (producto === "mejoravit") {
    return process.env.DEFAULT_ADVISOR_MEJORAVIT?.trim() || ADVISOR_ID_GUILLERMO;
  }
  if (producto === "compra_casa") {
    return process.env.DEFAULT_ADVISOR_COMPRA_CASA?.trim() || ADVISOR_ID_GUILLERMO;
  }
  return null;
}

/**
 * Único punto que decide el asesor de un lead nuevo o recién clasificado.
 * Un reparto por turnos o por carga solo necesita reemplazar esta función (ya es async).
 * Generadores, Paneles y sin_clasificar → null: no se asignan automáticamente.
 */
export async function elegirAsesorParaLead(args: {
  producto: ProductoLead;
}): Promise<string | null> {
  return asesorPorDefecto(args.producto);
}
