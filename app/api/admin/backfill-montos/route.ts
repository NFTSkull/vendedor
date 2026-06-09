export const maxDuration = 300;

const DELAY_MS = 20_000;
const SCRAPER_TIMEOUT_MS = 180_000;

type LeadRow = {
  id: string;
  nss: string;
  whatsapp_phone: string | null;
};

type RespuestaScraper = {
  success?: boolean;
  califica?: boolean;
  datos?: {
    saldoSubcuenta?: number | string;
  };
};

type ResultadoNss = {
  indice: number;
  lead_id: string;
  nss: string;
  whatsapp_phone: string | null;
  estado:
    | "montos_actualizados"
    | "no_califica"
    | "no_califica_sin_columna"
    | "sin_montos_validos"
    | "error";
  error?: string;
  montos?: {
    saldo_subcuenta: number | string;
    monto_aprobado_min: number;
    monto_aprobado_max: number;
  };
};

const PAGE_SIZE = 1000;

function calcularMontosAprobados(saldoSubcuenta: number): {
  monto_aprobado_min: number;
  monto_aprobado_max: number;
} {
  const montoPrestable = saldoSubcuenta * 0.9;
  return {
    monto_aprobado_min: Math.floor(montoPrestable * 0.8),
    monto_aprobado_max: Math.floor(montoPrestable / 0.85),
  };
}

function autorizado(req: Request): boolean {
  const secret = process.env.CRM_JWT_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice("Bearer ".length).trim();
  return token.length > 0 && token === secret;
}

function parseNumero(value: number | string | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") return 0;

  const limpio = value.replace(/[^0-9.]/g, "");
  const parsed = Number(limpio);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supabaseHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function consultarLeadsPendientes(
  supabaseUrl: string,
  serviceKey: string,
): Promise<LeadRow[]> {
  const pendientes: LeadRow[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${supabaseUrl}/rest/v1/leads`);
    url.searchParams.set("select", "id,nss,whatsapp_phone");
    url.searchParams.set("nss", "not.is.null");
    url.searchParams.set("saldo_subcuenta", "is.null");
    url.searchParams.set("order", "created_at.asc");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url, { headers: supabaseHeaders(serviceKey) });
    if (!res.ok) {
      throw new Error(
        `Error consultando leads: ${res.status} ${await res.text()}`,
      );
    }

    const rows = (await res.json()) as LeadRow[];
    pendientes.push(
      ...rows.filter(
        (lead) => typeof lead.nss === "string" && lead.nss.trim().length > 0,
      ),
    );

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return pendientes;
}

async function actualizarLead(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = `${supabaseUrl}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(serviceKey),
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
}

async function consultarPrecalificacionScraper(
  nss: string,
  workerIndex: number,
): Promise<RespuestaScraper> {
  const scraperUrl =
    process.env.SCRAPER_URL || process.env.SCRAPER_SERVICE_URL;
  const scraperSecret = process.env.SCRAPER_SECRET;

  if (!scraperUrl || !scraperSecret) {
    throw new Error(
      "Faltan SCRAPER_URL (o SCRAPER_SERVICE_URL) y/o SCRAPER_SECRET en el entorno",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCRAPER_TIMEOUT_MS);

  try {
    const res = await fetch(`${scraperUrl}/precalificar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-scraper-secret": scraperSecret,
      },
      body: JSON.stringify({ nss, workerIndex }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`SCRAPER_HTTP_${res.status}`);
    }

    return (await res.json()) as RespuestaScraper;
  } finally {
    clearTimeout(timeoutId);
  }
}

function esColumnaInexistente(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("estado_precalificacion") ||
    lower.includes("column") ||
    lower.includes("42703")
  );
}

async function marcarNoCalifica(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string,
): Promise<"no_califica" | "no_califica_sin_columna"> {
  try {
    await actualizarLead(supabaseUrl, serviceKey, leadId, {
      estado_precalificacion: "no_califica",
    });
    return "no_califica";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (esColumnaInexistente(msg)) {
      return "no_califica_sin_columna";
    }
    throw new Error(`Error al marcar no_califica: ${msg}`);
  }
}

async function ejecutarBackfill(): Promise<{
  total: number;
  resultados: ResultadoNss[];
}> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY");
  }

  const pendientes = await consultarLeadsPendientes(supabaseUrl, supabaseKey);
  const total = pendientes.length;
  const resultados: ResultadoNss[] = [];

  for (let index = 0; index < total; index++) {
    const lead = pendientes[index];
    const nss = lead.nss.trim();
    const base: ResultadoNss = {
      indice: index + 1,
      lead_id: lead.id,
      nss,
      whatsapp_phone: lead.whatsapp_phone,
      estado: "error",
    };

    try {
      const resultado = await consultarPrecalificacionScraper(nss, index);
      const saldoSubcuentaRaw = resultado.datos?.saldoSubcuenta;
      const saldoSubcuenta = parseNumero(saldoSubcuentaRaw);
      const success =
        resultado.success === true || resultado.califica === true;

      if (success && saldoSubcuenta > 0 && saldoSubcuentaRaw !== undefined) {
        const montos = calcularMontosAprobados(saldoSubcuenta);
        const payload = {
          saldo_subcuenta: saldoSubcuentaRaw,
          ...montos,
        };
        await actualizarLead(supabaseUrl, supabaseKey, lead.id, payload);

        resultados.push({
          ...base,
          estado: "montos_actualizados",
          montos: payload,
        });
      } else if (
        resultado.success === false ||
        resultado.califica === false
      ) {
        const estado = await marcarNoCalifica(
          supabaseUrl,
          supabaseKey,
          lead.id,
        );
        resultados.push({ ...base, estado });
      } else {
        resultados.push({
          ...base,
          estado: "sin_montos_validos",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resultados.push({ ...base, estado: "error", error: msg });
    }

    if (index < total - 1) {
      await sleep(DELAY_MS);
    }
  }

  return { total, resultados };
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const { total, resultados } = await ejecutarBackfill();
    return Response.json({ ok: true, total, resultados });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
