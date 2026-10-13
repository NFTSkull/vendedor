import { z } from "zod";

import { autorizarAsesorCrm, leadEnAlcance } from "@/lib/crmAcceso";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Precalificación manual desde el CRM. El chatbot no usa esta ruta: consulta el scraper
 * directamente desde el servidor (`lib/botStepsCore.ts`).
 */
const precalificarBodySchema = z.union([
  z.object({ leadId: z.string().uuid() }).strict(),
  z
    .object({
      nss: z.string().regex(/^\d{11}$/),
      phoneNumber: z
        .string()
        .regex(/^\d{10,13}$/)
        .optional(),
    })
    .strict(),
]);

type DatosCredito = {
  montoCredito?: number | string;
  saldoSubcuenta?: number | string;
  capacidadCompra?: number | string;
  pagoMensual?: number | string;
};

type ResultadoPrecalificacion = {
  califica: boolean;
  nombre?: string;
  nss?: string;
  mensaje?: string;
  datos?: DatosCredito;
};

type LeadObjetivo = {
  id: string;
  advisor_id: string | null;
  nss: string | null;
  whatsapp_phone: string;
};

const ACCION_SOLICITADA = "precalificacion_solicitada";
const ACCION_COMPLETADA = "precalificacion_completada";
/** El scraper tiene timeout de 180 s: una solicitud más reciente se considera en curso. */
const VENTANA_EN_CURSO_MS = 200_000;
const LIMITE_POR_ASESOR = 10;
const VENTANA_LIMITE_MS = 10 * 60_000;

const SCRAPER_URL = process.env.SCRAPER_SERVICE_URL;
const SCRAPER_SECRET = process.env.SCRAPER_SECRET;

function error(mensaje: string, status: number): Response {
  return Response.json({ error: mensaje }, { status });
}

export async function POST(request: Request) {
  const sesion = await autorizarAsesorCrm(request);
  if ("respuesta" in sesion) return sesion.respuesta;
  const { asesor } = sesion;
  const advisorId = asesor.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido", 400);
  }
  const parsed = precalificarBodySchema.safeParse(body);
  if (!parsed.success) return error("Parámetros inválidos", 400);

  const supabase = getSupabaseAdmin();

  try {

    let lead: LeadObjetivo;
    if ("leadId" in parsed.data) {
      const { data, error: leadError } = await supabase
        .from("leads")
        .select("id, advisor_id, nss, whatsapp_phone")
        .eq("id", parsed.data.leadId)
        .maybeSingle();
      if (leadError) throw leadError;
      if (!data) return error("Lead no encontrado", 404);
      if (!leadEnAlcance(data.advisor_id, asesor)) return error("Sin permisos sobre este lead", 403);
      if (typeof data.nss !== "string" || !/^\d{11}$/.test(data.nss)) {
        return error("Este lead no tiene un NSS válido", 400);
      }
      lead = data as LeadObjetivo;
    } else {
      const { nss } = parsed.data;
      const phone = parsed.data.phoneNumber ?? `crm-${nss}`;

      const { data: conMismoNss, error: nssError } = await supabase
        .from("leads")
        .select("advisor_id")
        .eq("nss", nss);
      if (nssError) throw nssError;
      if ((conMismoNss ?? []).some((l) => !leadEnAlcance(l.advisor_id, asesor))) {
        return error("Sin permisos sobre este NSS", 403);
      }

      const { data: existente, error: phoneError } = await supabase
        .from("leads")
        .select("id, advisor_id, nss, whatsapp_phone")
        .eq("whatsapp_phone", phone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (phoneError) throw phoneError;

      if (existente) {
        if (!leadEnAlcance(existente.advisor_id, asesor)) {
          return error("Sin permisos sobre este teléfono", 403);
        }
        if (typeof existente.nss === "string" && existente.nss.trim() && existente.nss !== nss) {
          return error("El teléfono pertenece a un lead con otro NSS", 409);
        }
        lead = existente as LeadObjetivo;
      } else {
        const { data: creado, error: insertError } = await supabase
          .from("leads")
          .insert({
            whatsapp_phone: phone,
            estado: "nuevo",
            nss,
            advisor_id: asesor.esAdmin ? null : advisorId,
          })
          .select("id, advisor_id, nss, whatsapp_phone")
          .single();
        if (insertError) throw insertError;
        lead = creado as LeadObjetivo;
      }
    }
    const nss = lead.nss as string;

    const ahora = Date.now();
    const { count: recientes, error: countError } = await supabase
      .from("lead_actions")
      .select("id", { count: "exact", head: true })
      .eq("advisor_id", advisorId)
      .eq("accion", ACCION_SOLICITADA)
      .gte("created_at", new Date(ahora - VENTANA_LIMITE_MS).toISOString());
    if (countError) throw countError;
    if ((recientes ?? 0) >= LIMITE_POR_ASESOR) {
      return error("Demasiadas precalificaciones; intenta en unos minutos", 429);
    }

    const { data: ultima, error: ultimaError } = await supabase
      .from("lead_actions")
      .select("accion, created_at")
      .eq("lead_id", lead.id)
      .in("accion", [ACCION_SOLICITADA, ACCION_COMPLETADA])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultimaError) throw ultimaError;
    if (
      ultima?.accion === ACCION_SOLICITADA &&
      ahora - Date.parse(String(ultima.created_at)) < VENTANA_EN_CURSO_MS
    ) {
      return error("Ya hay una precalificación en curso para este lead", 409);
    }

    if (!SCRAPER_URL || !SCRAPER_SECRET) {
      return error("Servicio de precalificación no configurado", 500);
    }

    const { error: actionError } = await supabase.from("lead_actions").insert({
      lead_id: lead.id,
      advisor_id: advisorId,
      accion: ACCION_SOLICITADA,
      nota: null,
    });
    if (actionError) throw actionError;

    let resultado: ResultadoPrecalificacion;
    try {
      resultado = await consultarScraper(nss);
    } catch (err) {
      console.error("[precalificar] Falla del scraper", {
        lead_id: lead.id,
        tipo: err instanceof Error && err.name === "AbortError" ? "timeout" : "error",
      });
      await registrarCompletada(lead.id, advisorId, "error");
      return error("No se pudo completar la precalificación", 502);
    }

    const updateData: Record<string, unknown> = {
      nss,
      precalificacion_status: resultado.califica ? "aprobado" : "rechazado",
      precalificacion_resultado: resultado,
      precalificado_at: new Date().toISOString(),
    };

    if (resultado.califica) {
      const saldoSubcuenta = normalizarNumero(resultado.datos?.saldoSubcuenta);
      const montoExacto = Math.floor(saldoSubcuenta);
      updateData.nombre_infonavit = resultado.nombre;
      updateData.monto_credito = resultado.datos?.montoCredito;
      updateData.saldo_subcuenta = resultado.datos?.saldoSubcuenta;
      updateData.monto_base = montoExacto;
      updateData.monto_aprobado_min = montoExacto;
      updateData.monto_aprobado_max = montoExacto;
      updateData.capacidad_compra = resultado.datos?.capacidadCompra;
      updateData.pago_mensual = resultado.datos?.pagoMensual;
    }

    const { error: updateError } = await supabase.from("leads").update(updateData).eq("id", lead.id);
    if (updateError) throw updateError;
    await registrarCompletada(lead.id, advisorId, resultado.califica ? "aprobado" : "rechazado");

    return Response.json({
      ok: true,
      leadId: lead.id,
      resultado: {
        califica: resultado.califica === true,
        nombre: resultado.nombre,
        nss,
        mensaje: resultado.mensaje,
        datos: {
          saldoSubcuenta: resultado.datos?.saldoSubcuenta,
          capacidadCompra: resultado.datos?.capacidadCompra,
          pagoMensual: resultado.datos?.pagoMensual,
        },
      },
    });
  } catch (err) {
    console.error("[precalificar] Error interno", {
      advisor_id: advisorId,
      codigo: (err as { code?: unknown } | null)?.code ?? null,
    });
    return error("Error interno", 500);
  }
}

async function consultarScraper(nss: string): Promise<ResultadoPrecalificacion> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(`${SCRAPER_URL}/precalificar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-scraper-secret": SCRAPER_SECRET as string,
      },
      body: JSON.stringify({ nss }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`scraper_http_${res.status}`);
    return (await res.json()) as ResultadoPrecalificacion;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function registrarCompletada(leadId: string, advisorId: string, nota: string) {
  const { error: actionError } = await getSupabaseAdmin().from("lead_actions").insert({
    lead_id: leadId,
    advisor_id: advisorId,
    accion: ACCION_COMPLETADA,
    nota,
  });
  if (actionError) {
    console.error("[precalificar] Error registrando lead_actions", { lead_id: leadId });
  }
}

function normalizarNumero(value: number | string | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value !== "string") return 0;

  const limpio = value.replace(/[^0-9.]/g, "");
  const num = Number(limpio);
  return Number.isFinite(num) ? num : 0;
}
