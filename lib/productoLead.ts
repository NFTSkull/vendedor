import { elegirAsesorParaLead } from "@/lib/asignacionAsesor";
import type { ProductoLead } from "@/lib/detectarProducto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const ACCION_CAMBIO_PRODUCTO = "cambio_producto_automatico";
export const ACCION_ASESOR_AUTOMATICO = "asesor_asignado_automatico";

export type OrigenCambioProducto = "comando" | "menu" | "primer_mensaje";

/**
 * `advisor_id` siempre null: los crons de reenganche tratan cualquier acción con asesor
 * como atención humana y dejarían de escribirle al cliente.
 */
export async function registrarAccionAutomatica(
  leadId: string,
  accion: string,
  nota: string,
): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin().from("lead_actions").insert({
      lead_id: leadId,
      advisor_id: null,
      accion,
      nota,
    });
    if (error) {
      console.error("[productoLead] Error registrando lead_actions:", error);
    }
  } catch (err) {
    console.error("[productoLead] Error registrando lead_actions:", err);
  }
}

/** Devuelve el asesor asignado, o null si el producto no se asigna o el lead ya tenía asesor. */
export async function asignarAsesorPorDefectoSiVacio(
  leadId: string,
  producto: ProductoLead,
): Promise<string | null> {
  const advisorId = await elegirAsesorParaLead({ producto });
  if (!advisorId) return null;

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("leads")
      .update({ advisor_id: advisorId })
      .eq("id", leadId)
      .is("advisor_id", null)
      .select("id");
    if (error) {
      console.error("[productoLead] Error asignando asesor por defecto:", error);
      return null;
    }
    if (!data || data.length === 0) return null;
  } catch (err) {
    console.error("[productoLead] Error asignando asesor por defecto:", err);
    return null;
  }

  await registrarAccionAutomatica(leadId, ACCION_ASESOR_AUTOMATICO, `${producto}: ${advisorId}`);
  return advisorId;
}

/**
 * Lleva a `leads.producto` el producto recién fijado en la conversación y, si ese producto
 * tiene asesor por defecto y el lead no tiene asesor, se lo asigna.
 */
export async function sincronizarProductoLead(
  leadId: string,
  producto: ProductoLead,
  origen: OrigenCambioProducto,
): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("leads")
      .update({ producto })
      .eq("id", leadId);
    if (error) {
      console.error("[productoLead] Error sincronizando producto:", error);
      return false;
    }
  } catch (err) {
    console.error("[productoLead] Error sincronizando producto:", err);
    return false;
  }

  await registrarAccionAutomatica(leadId, ACCION_CAMBIO_PRODUCTO, `${origen}: ${producto}`);
  await asignarAsesorPorDefectoSiVacio(leadId, producto);
  return true;
}
