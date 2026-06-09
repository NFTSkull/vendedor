/**
 * Backfill de montos de precalificación para leads con NSS pero sin saldo_subcuenta.
 *
 * Uso: npx ts-node scripts/backfill-montos.ts
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

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

function loadEnvFiles(): void {
  const root = resolve(process.cwd());
  for (const file of [".env.local", ".env"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;

      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
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
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
  const url = new URL(`${supabaseUrl}/rest/v1/leads`);
  url.searchParams.set("select", "id,nss,whatsapp_phone");
  url.searchParams.set("nss", "not.is.null");
  url.searchParams.set("saldo_subcuenta", "is.null");
  url.searchParams.set("order", "created_at.asc");

  const res = await fetch(url, { headers: supabaseHeaders(serviceKey) });
  if (!res.ok) {
    throw new Error(`Error consultando leads: ${res.status} ${await res.text()}`);
  }

  const rows = (await res.json()) as LeadRow[];
  return rows.filter(
    (lead) => typeof lead.nss === "string" && lead.nss.trim().length > 0,
  );
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
  nss: string,
  etiqueta: string,
): Promise<void> {
  try {
    await actualizarLead(supabaseUrl, serviceKey, leadId, {
      estado_precalificacion: "no_califica",
    });
    console.log(
      `${etiqueta} NSS ${nss}: marcado estado_precalificacion=no_califica`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (esColumnaInexistente(msg)) {
      console.log(
        `${etiqueta} NSS ${nss}: no califica — columna estado_precalificacion no existe, solo log`,
      );
      return;
    }
    throw new Error(`Error al marcar no_califica: ${msg}`);
  }
}

async function main(): Promise<void> {
  loadEnvFiles();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY");
  }

  const pendientes = await consultarLeadsPendientes(supabaseUrl, supabaseKey);
  const total = pendientes.length;

  console.log(`Encontrados ${total} lead(s) con NSS y sin saldo_subcuenta.\n`);

  if (total === 0) {
    return;
  }

  for (let index = 0; index < total; index++) {
    const lead = pendientes[index];
    const nss = lead.nss.trim();
    const etiqueta = `[${index + 1}/${total}]`;
    const telefono = lead.whatsapp_phone ?? "(sin teléfono)";

    console.log(
      `${etiqueta} Procesando NSS ${nss} (lead ${lead.id}, tel ${telefono})...`,
    );

    try {
      const resultado = await consultarPrecalificacionScraper(nss, index);
      const saldoSubcuentaRaw = resultado.datos?.saldoSubcuenta;
      const saldoSubcuenta = parseNumero(saldoSubcuentaRaw);
      const success =
        resultado.success === true || resultado.califica === true;

      if (success && saldoSubcuenta > 0 && saldoSubcuentaRaw !== undefined) {
        await actualizarLead(supabaseUrl, supabaseKey, lead.id, {
          saldo_subcuenta: saldoSubcuentaRaw,
          monto_base: saldoSubcuenta,
          monto_aprobado_min: saldoSubcuenta,
          monto_aprobado_max: saldoSubcuenta,
        });

        console.log(
          `${etiqueta} NSS ${nss}: montos actualizados — saldo_subcuenta=${saldoSubcuentaRaw}, monto_base/min/max=${saldoSubcuenta}`,
        );
      } else if (
        resultado.success === false ||
        resultado.califica === false
      ) {
        await marcarNoCalifica(
          supabaseUrl,
          supabaseKey,
          lead.id,
          nss,
          etiqueta,
        );
      } else {
        console.log(
          `${etiqueta} NSS ${nss}: respuesta sin montos válidos (success=${String(resultado.success)}, califica=${String(resultado.califica)}, saldo=${String(saldoSubcuentaRaw)})`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${etiqueta} NSS ${nss}: error — ${msg}`);
    }

    if (index < total - 1) {
      console.log(
        `${etiqueta} Esperando ${DELAY_MS / 1000}s antes del siguiente NSS...\n`,
      );
      await sleep(DELAY_MS);
    }
  }

  console.log("\nBackfill finalizado.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
