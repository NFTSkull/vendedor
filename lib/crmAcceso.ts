import { requireCrmAuth } from "@/lib/crmAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const ADMIN_EMAIL_CRM = "admin@mejoravit.com";

export type AsesorCrm = { id: string; esAdmin: boolean };

type Rechazo = { respuesta: Response };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rechazo(error: string, status: number): Rechazo {
  return { respuesta: Response.json({ error }, { status }) };
}

/**
 * Sesión del CRM: JWT válido y asesor existente y activo en la base. Se relee en cada
 * solicitud para que una baja surta efecto aunque el token (7 días) siga vigente.
 */
export async function autorizarAsesorCrm(req: Request): Promise<{ asesor: AsesorCrm } | Rechazo> {
  const auth = await requireCrmAuth(req);
  if (!auth) return rechazo("No autorizado", 401);

  const { data: advisor, error } = await getSupabaseAdmin()
    .from("advisors")
    .select("id, email, activo")
    .eq("id", auth.sub)
    .maybeSingle();
  if (error) {
    console.error("[crmAcceso] Error consultando asesor", { codigo: error.code ?? null });
    return rechazo("Error interno", 500);
  }
  if (!advisor || advisor.activo !== true) return rechazo("Sin permisos", 403);

  return {
    asesor: {
      id: String(advisor.id),
      esAdmin: String(advisor.email ?? "").toLowerCase() === ADMIN_EMAIL_CRM,
    },
  };
}

/** Regla de la bandeja: el admin opera leads sin asignar y cada asesor solo los suyos. */
export function leadEnAlcance(advisorIdLead: unknown, asesor: AsesorCrm): boolean {
  return asesor.esAdmin ? advisorIdLead === null : advisorIdLead === asesor.id;
}

type FiltroAlcance<T> = {
  eq(column: string, value: string): T;
  is(column: string, value: null): T;
};

/** Aplica la misma regla en la consulta, para que lecturas y escrituras no salgan del alcance. */
export function conAlcance<T extends FiltroAlcance<T>>(query: T, asesor: AsesorCrm): T {
  return asesor.esAdmin ? query.is("advisor_id", null) : query.eq("advisor_id", asesor.id);
}

/**
 * Sesión + lead dentro del alcance, antes de leer mensajes, procesar archivos, escribir
 * o enviar WhatsApp. Teléfono y demás datos se toman de la base, nunca del navegador.
 */
export async function autorizarLeadCrm<L extends Record<string, unknown>>(
  req: Request,
  leadId: string,
  columnas: string,
): Promise<{ asesor: AsesorCrm; lead: L } | Rechazo> {
  const sesion = await autorizarAsesorCrm(req);
  if ("respuesta" in sesion) return sesion;
  if (!UUID.test(leadId)) return rechazo("Lead no encontrado", 404);

  const { data: lead, error } = await getSupabaseAdmin()
    .from("leads")
    .select(`${columnas}, advisor_id`)
    .eq("id", leadId)
    .maybeSingle();
  if (error) {
    console.error("[crmAcceso] Error consultando lead", { lead_id: leadId, codigo: error.code ?? null });
    return rechazo("Error interno", 500);
  }
  if (!lead) return rechazo("Lead no encontrado", 404);
  const fila = lead as unknown as Record<string, unknown>;
  if (!leadEnAlcance(fila.advisor_id, sesion.asesor)) return rechazo("Sin permisos sobre este lead", 403);

  const { advisor_id: _advisorId, ...resto } = fila;
  void _advisorId;
  return { asesor: sesion.asesor, lead: resto as L };
}
