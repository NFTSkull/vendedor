import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { procesarYEvolucionar } from "@/lib/botSteps";
import {
  MSG_BIENVENIDA,
  MSG_CONSULTA_EN_CURSO,
  MSG_CONSULTA_NO_DISPONIBLE,
  MSG_CREDITO_ACTIVO,
  MSG_INFONAVIT,
  MSG_NSS_EN_ESPERA,
  MSG_PREGUNTA_LABOR,
  MSG_SOLICITUD_DATOS,
} from "@/lib/botStepsCore";
import { aplicarComandoProducto } from "@/lib/comandoProducto";
import { conversationMemory } from "@/lib/conversationMemory";
import {
  ADVISOR_ID_GUILLERMO,
  NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
} from "@/lib/detectarProducto";
import { ensureLeadProvisional } from "@/lib/leadProvisional";
import { MSG_MENU_PRODUCTO } from "@/lib/menuProducto";
import { MSG_RECHAZO_OFERTA, type TramiteMejoravit } from "@/lib/tramiteMejoravit";

const conversationsStore = new Map<
  string,
  {
    state: string;
    nss: string | null;
    lead_id: string | null;
    producto?: string;
    data?: Record<string, unknown>;
  }
>();
const leadsById = new Map<string, Record<string, unknown>>();
const leadsByPhone = new Map<string, string>();
const leadsInsertRows: Array<Record<string, unknown>> = [];
const leadsUpdateRows: Array<{ id: string; patch: Record<string, unknown> }> = [];
const leadActionsRows: Array<Record<string, unknown>> = [];
let leadCounter = 0;

function makeLeadsSelect() {
  return {
    eq: (col: string, val: string) => ({
      order: () => ({
        limit: () => ({
          maybeSingle: async () => {
            if (col !== "whatsapp_phone") {
              return { data: null, error: null };
            }
            const id = leadsByPhone.get(val);
            if (!id) return { data: null, error: null };
            const row = leadsById.get(id);
            return {
              data: row
                ? {
                    id,
                    whatsapp_phone: val,
                    estado: (row.estado as string) ?? "nuevo",
                  }
                : null,
              error: null,
            };
          },
        }),
      }),
      maybeSingle: async () => {
        if (col !== "id") return { data: null, error: null };
        const row = leadsById.get(val);
        if (!row) return { data: null, error: null };
        return {
          data: {
            ...row,
            id: val,
            estado: (row.estado as string) ?? "nuevo",
            horario: row.horario ?? null,
            nss: row.nss ?? null,
          },
          error: null,
        };
      },
    }),
  };
}

/** UPDATE encadenable como PostgREST: `.eq("id")`, `.eq("tramite_mejoravit->>version")`, `.is()`, `.select()`. */
function makeLeadsUpdate(patch: Record<string, unknown>) {
  let id: string | null = null;
  const filtros: Array<(row: Record<string, unknown>) => boolean> = [];
  const ejecutar = () => {
    const current = id ? leadsById.get(id) : undefined;
    if (!id || !current || !filtros.every((f) => f(current))) {
      return { data: [], error: null };
    }
    leadsUpdateRows.push({ id, patch });
    leadsById.set(id, { ...current, ...patch });
    return { data: [{ id }], error: null };
  };
  const builder = {
    eq(col: string, val: string) {
      if (col === "id") id = val;
      else if (col === "tramite_mejoravit->>version") {
        filtros.push(
          (row) =>
            String((row.tramite_mejoravit as { version?: number } | null)?.version) === val,
        );
      }
      return builder;
    },
    is(col: string, val: null) {
      filtros.push((row) => (row[col] ?? null) === val);
      return builder;
    },
    select() {
      return builder;
    },
    then<T>(resolve: (v: ReturnType<typeof ejecutar>) => T, reject?: (e: unknown) => T) {
      return Promise.resolve(ejecutar()).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "leads") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const id = `lead-${++leadCounter}`;
                const full = { ...row, id };
                leadsInsertRows.push(row);
                leadsById.set(id, full);
                if (typeof row.whatsapp_phone === "string") {
                  leadsByPhone.set(row.whatsapp_phone, id);
                }
                return { data: { id }, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => makeLeadsUpdate(patch),
          select: () => makeLeadsSelect(),
        };
      }
      if (table === "conversations") {
        return {
          select: () => ({
            eq: (_col: string, phone: string) => ({
              maybeSingle: async () => {
                const stored = conversationsStore.get(phone);
                return {
                  data: stored
                    ? {
                        state: stored.state,
                        nss: stored.nss,
                        lead_id: stored.lead_id,
                        producto: stored.producto ?? null,
                        data: stored.data ?? null,
                      }
                    : null,
                  error: null,
                };
              },
            }),
          }),
          upsert: async (row: {
            whatsapp_phone: string;
            state: string;
            nss: string | null;
            lead_id?: string | null;
            producto?: string;
            data?: Record<string, unknown>;
          }) => {
            const prev = conversationsStore.get(row.whatsapp_phone);
            conversationsStore.set(row.whatsapp_phone, {
              state: row.state,
              nss: row.nss,
              lead_id:
                row.lead_id !== undefined ? row.lead_id : (prev?.lead_id ?? null),
              producto: row.producto !== undefined ? row.producto : prev?.producto,
              data:
                row.data !== undefined
                  ? row.data
                  : prev?.data,
            });
            return { error: null };
          },
          delete: () => ({
            eq: async (_col: string, phone: string) => {
              conversationsStore.delete(phone);
              return { error: null };
            },
          }),
        };
      }
      if (table === "lead_actions") {
        return {
          insert: async (row: Record<string, unknown>) => {
            leadActionsRows.push(row);
            return { error: null };
          },
        };
      }
      return {};
    },
  }),
}));

async function llegarANss(phone: string) {
  for (const texto of ["Hola", "Sí", "Sí", "No"]) {
    await procesarYEvolucionar({ phone, textoUsuario: texto });
  }
}

const FLUJO_SI = [
  "Hola",
  "si",
  "SI",
  "no",
  "12345678901",
] as const;

describe("botSteps memoria Map", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.SCRAPER_URL = "https://scraper.test";
    process.env.SCRAPER_SECRET = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/precalificar")) {
          return new Response(
            JSON.stringify({
              success: true,
              datos: {
                saldoSubcuenta: 100000,
                montoCredito: 85000,
              },
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    conversationMemory.clear();
    conversationsStore.clear();
    leadsById.clear();
    leadsByPhone.clear();
    leadsInsertRows.length = 0;
    leadsUpdateRows.length = 0;
    leadActionsRows.length = 0;
    leadCounter = 0;
  });

  it("crea lead provisional y al aprobar guarda NSS, montos originales y precalificación", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const p = "5211111111111";

    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });

    expect(leadsInsertRows[0]).toMatchObject({
      whatsapp_phone: p,
      estado: "nuevo",
      nss: "",
      horario: "",
    });
    expect(conversationMemory.get(p)?.lead_id).toBe("lead-1");

    for (const paso of FLUJO_SI.slice(1)) {
      await procesarYEvolucionar({ phone: p, textoUsuario: paso });
    }

    expect(leadsUpdateRows.some((u) => u.patch.nss === "12345678901")).toBe(true);
    const lead = leadsById.get("lead-1")!;
    expect(lead).toMatchObject({
      saldo_subcuenta: 100000,
      monto_base: 100000,
      monto_credito: 85000,
      precalificacion_status: "aprobado",
    });
    expect(lead.precalificacion_resultado).toMatchObject({
      success: true,
      datos: { saldoSubcuenta: 100000, montoCredito: 85000 },
    });
    expect(lead.horario).toBe("");

    const logs = JSON.stringify(logSpy.mock.calls);
    expect(logs).not.toContain("12345678901");
    expect(logs).not.toContain(p);
    logSpy.mockRestore();
  });

  it("precalificación aprobada: ofrece el trámite con el importe neto estimado, sin horarios ni asesor", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const p = "5211111111111";
    let reply: string | null = null;

    for (const paso of FLUJO_SI) {
      reply = await procesarYEvolucionar({ phone: p, textoUsuario: paso });
      expect(reply).toBeTruthy();
    }

    expect(reply).toContain("importe neto estimado para tu crédito Mejoravit");
    expect(reply).toContain("💰 $90,000");
    expect(reply).toContain("sujeta a validación");
    expect(reply).toContain("¿Te gustaría continuar?");
    expect(reply).not.toMatch(/asesor|horario|contactar|llamar/i);
    expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
    expect(logSpy).toHaveBeenCalledWith("[lead confirmado]", { lead_id: "lead-1" });

    logSpy.mockRestore();
  });

  it("aplica el tope de $169,000 antes del 90%: saldo mayor al tope ofrece $152,100", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ califica: true, datos: { saldoSubcuenta: "250,000.00" } }),
          { status: 200 },
        ),
      ),
    );
    const p = "5233333333333";
    await llegarANss(p);

    const replyNss = await procesarYEvolucionar({ phone: p, textoUsuario: "09876543210" });

    expect(replyNss).toContain("💰 $152,100");
    expect(leadsById.get("lead-1")?.saldo_subcuenta).toBe("250,000.00");
    expect(leadsById.get("lead-1")?.tramite_mejoravit).toMatchObject({
      credito: { montoBase: 250000, montoTopado: 169000, montoNetoEstimado: 152100 },
    });
  });

  it("respuesta sin datos válidos: avisa problema temporal sin volver a pedir el NSS", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/precalificar")) {
          return new Response(JSON.stringify({ success: true, datos: {} }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const p = "5255555555555";
    await llegarANss(p);

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "12345678901",
    });

    expect(reply).toBe(MSG_CONSULTA_NO_DISPONIBLE);
    expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
    expect(conversationMemory.get(p)?.data?.nssPendiente).toBe("12345678901");
    expect(errorSpy).toHaveBeenCalledWith("[scraper] Precalificación fallida", {
      tipo: "respuesta_inesperada",
      lead_id: "lead-1",
    });
    errorSpy.mockRestore();
  });

  describe("falla del scraper", () => {
    const NSS = "12345678901";
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    function scraperQueFalla(falla: () => Promise<Response>) {
      const llamadasScraper: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).includes("/precalificar")) {
            llamadasScraper.push(String(init?.body ?? ""));
            return falla();
          }
          return new Response("{}", { status: 200 });
        }),
      );
      return llamadasScraper;
    }

    function logsDeScraper(): string {
      return JSON.stringify(
        errorSpy.mock.calls.filter((c) => c[0] === "[scraper] Precalificación fallida"),
      );
    }

    it("app de Railway inexistente (404 fallback): mensaje temporal, conserva NSS y estado", async () => {
      scraperQueFalla(async () =>
        new Response('{"message":"Application not found"}', {
          status: 404,
          headers: { "x-railway-fallback": "true" },
        }),
      );
      const p = "5266666666666";
      await llegarANss(p);

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: NSS });

      expect(reply).toBe(MSG_CONSULTA_NO_DISPONIBLE);
      expect(reply).not.toContain("NSS de 11");
      expect(reply).not.toContain("Compárteme");
      expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
      expect(conversationMemory.get(p)?.data?.nssPendiente).toBe(NSS);
      expect(leadsUpdateRows.some((u) => u.patch.nss === NSS)).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith("[scraper] Precalificación fallida", {
        tipo: "scraper_http_404_railway_app_no_encontrada",
        lead_id: "lead-1",
      });
      expect(logsDeScraper()).not.toContain(NSS);
      expect(logsDeScraper()).not.toContain(p);
    });

    it("error de red: registra el código sin datos personales", async () => {
      scraperQueFalla(async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), {
            code: "ENOTFOUND",
          }),
        });
      });
      const p = "5267676767676";
      await llegarANss(p);

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: NSS });

      expect(reply).toBe(MSG_CONSULTA_NO_DISPONIBLE);
      expect(errorSpy).toHaveBeenCalledWith("[scraper] Precalificación fallida", {
        tipo: "red_ENOTFOUND",
        lead_id: "lead-1",
      });
      expect(logsDeScraper()).not.toContain(NSS);
      expect(logsDeScraper()).not.toContain(p);
    });

    it("el siguiente mensaje reintenta con el NSS guardado sin pedirlo otra vez", async () => {
      let disponible = false;
      const llamadas = scraperQueFalla(async () =>
        disponible
          ? new Response(
              JSON.stringify({ success: true, datos: { saldoSubcuenta: 100000 } }),
              { status: 200 },
            )
          : new Response("{}", { status: 502 }),
      );
      const p = "5268686868686";
      await llegarANss(p);

      expect(await procesarYEvolucionar({ phone: p, textoUsuario: NSS })).toBe(
        MSG_CONSULTA_NO_DISPONIBLE,
      );
      expect(errorSpy).toHaveBeenCalledWith("[scraper] Precalificación fallida", {
        tipo: "scraper_http_502",
        lead_id: "lead-1",
      });

      disponible = true;
      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "ya?" });

      expect(reply).toContain("importe neto estimado");
      expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
      expect(llamadas).toHaveLength(2);
      expect(JSON.parse(llamadas[1]).nss).toBe(NSS);
    });

    it("si el cliente manda otro NSS después de la falla, se usa el nuevo", async () => {
      let disponible = false;
      const llamadas = scraperQueFalla(async () =>
        disponible
          ? new Response(
              JSON.stringify({ success: true, datos: { saldoSubcuenta: 100000 } }),
              { status: 200 },
            )
          : new Response("{}", { status: 500 }),
      );
      const p = "5269696969696";
      await llegarANss(p);
      await procesarYEvolucionar({ phone: p, textoUsuario: NSS });

      disponible = true;
      await procesarYEvolucionar({ phone: p, textoUsuario: "98765432109" });

      expect(JSON.parse(llamadas[1]).nss).toBe("98765432109");
    });
  });

  it("marca no_interesado ante opt-out explícito", async () => {
    const p = "5231313131313";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "no me interesa",
    });

    expect(reply).toContain("no te molestaremos más");
    expect(conversationMemory.get(p)?.state).toBe("finalizado");
    expect(
      leadsUpdateRows.some((u) => u.patch.estado === "no_interesado"),
    ).toBe(true);
  });

  it("marca descalificado cuando el scraper indica no califica", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/precalificar")) {
          return new Response(
            JSON.stringify({ success: false, califica: false }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const p = "5222222222222";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "12345678901",
    });

    expect(reply).toContain("no calificas para el crédito Mejoravit");
    expect(conversationMemory.get(p)?.state).toBe("finalizado");
    expect(
      leadsUpdateRows.some((u) => u.patch.estado === "descalificado"),
    ).toBe(true);
  });

  it("rechaza sin relación laboral vigente", async () => {
    const p = "5244444444444";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "no" });

    expect(reply).toContain("trabajadores activos en Nuevo León");
    expect(reply).not.toContain("Un asesor se pondrá en contacto");
  });

  it("reinicia el flujo con comando reiniciar en cualquier paso", async () => {
    const p = "5277777777777";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "REINICIAR",
    });

    expect(reply).toContain("Buenas tardes, gracias por contactarnos");
    expect(reply).toContain("relación laboral vigente en Nuevo León");
    expect(conversationMemory.get(p)?.state).toBe("esperando_labor_vigente");
    expect(conversationMemory.get(p)?.name).toBeNull();
    expect(conversationMemory.get(p)?.nss).toBeNull();
    expect(conversationMemory.get(p)?.lead_id).toBe("lead-1");
  });

  it.each(["reiniciar", "Reiniciar", "empezar de nuevo", "iniciar de nuevo"])(
    "acepta comando de reinicio: %s",
    async (comando) => {
      const p = "5288888888888";
      await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
      await procesarYEvolucionar({ phone: p, textoUsuario: comando });

      expect(conversationMemory.get(p)?.state).toBe("esperando_labor_vigente");
    },
  );

  it("acepta solo NSS de 11 dígitos sin nombre", async () => {
    const p = "5299999999999";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });

    const replyNss = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "01234567890",
    });

    expect(replyNss).toContain("💰 $90,000");
    expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
  });

  it("rechaza NSS cuando trae más de 11 dígitos", async () => {
    const p = "5210101010101";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "123456789012",
    });

    expect(reply).toContain("11 dígitos");
    expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
    expect(conversationMemory.get(p)?.nss).toBeNull();
  });

  it("conversación antigua en esperando_horario con saldo guardado: pasa al trámite sin repetir la consulta", async () => {
    const p = "5213131313131";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    conversationsStore.set(p, {
      state: "esperando_horario",
      nss: null,
      lead_id: "lead-1",
      data: { nss: "43119209344", horario: "" },
    });
    leadsById.set("lead-1", {
      id: "lead-1",
      whatsapp_phone: p,
      estado: "nuevo",
      nss: "43119209344",
      horario: "",
      saldo_subcuenta: "200,000.00",
      monto_base: 200000,
    });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "Mañana a las 11am",
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/precalificar"))).toBe(false);
    expect(reply).toContain("$152,100");
    expect(reply).not.toMatch(/asesor/i);
    expect(reply).not.toMatch(/horario/i);
    expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
    expect(conversationMemory.get(p)?.data).toMatchObject({ horario: "", nss: "43119209344" });
    const lead = leadsById.get("lead-1");
    expect(lead?.precalificacion_resultado).toBeUndefined();
    expect(lead?.saldo_subcuenta).toBe("200,000.00");
    expect(lead?.tramite_mejoravit).toMatchObject({
      etapa: "oferta",
      credito: { montoNetoEstimado: 152100 },
      datos: { nss: { valor: "43119209344" } },
    });
  });

  it("conversación antigua en esperando_horario con saldo de otro NSS: consulta en lugar de reutilizarlo", async () => {
    const p = "5213131313132";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    conversationsStore.set(p, {
      state: "esperando_horario",
      nss: null,
      lead_id: "lead-1",
      data: { nss: "43119209344" },
    });
    leadsById.set("lead-1", {
      id: "lead-1",
      whatsapp_phone: p,
      estado: "nuevo",
      nss: "11111111111",
      saldo_subcuenta: "200,000.00",
    });

    const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "Mañana a las 11am" });

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/precalificar"))).toHaveLength(1);
    expect(reply).toContain("$90,000");
    expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
  });

  it("sin NSS guardado pide NSS después de capturar horario", async () => {
    const p = "5214141414141";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });

    conversationsStore.set(p, {
      state: "esperando_horario",
      nss: null,
      lead_id: "lead-1",
    });
    leadsById.set("lead-1", {
      id: "lead-1",
      whatsapp_phone: p,
      estado: "nuevo",
      nss: "",
      horario: "",
    });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "Martes 3pm",
    });

    expect(reply).toContain("Compárteme tu Número de Seguro Social");
    expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
  });

  it("rechaza crédito Infonavit activo", async () => {
    const p = "5255555555555";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    expect(reply).toContain("no aplica si ya tienes un crédito Infonavit activo");
  });

  describe("trámite Mejoravit por WhatsApp", () => {
    const NSS = "12345678901";

    function scraperContado() {
      const llamadas: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).includes("/precalificar")) {
            llamadas.push(String(init?.body ?? ""));
            return new Response(
              JSON.stringify({
                califica: true,
                nss: NSS,
                nombre: "JUAN CARLOS PEREZ LOPEZ",
                empresa: "ACME SA DE CV",
                registroPatronal: "A1234567890",
                datos: { saldoSubcuenta: "100000", montoCredito: "85000" },
              }),
              { status: 200 },
            );
          }
          return new Response("{}", { status: 200 });
        }),
      );
      return llamadas;
    }

    const tramiteDe = (leadId: string) =>
      leadsById.get(leadId)?.tramite_mejoravit as TramiteMejoravit | undefined;

    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("acepta, consiente y captura por el chat; el avance vive en leads.tramite_mejoravit", async () => {
      scraperContado();
      const p = "5217000000001";
      const enviar = (texto: string) => procesarYEvolucionar({ phone: p, textoUsuario: texto });
      await llegarANss(p);
      await enviar(NSS);

      expect(await enviar("Sí, me interesa")).toContain("/privacidad");
      expect(await enviar("Sí, autorizo")).toContain("¿Cuál es tu nombre");
      await enviar("Juan Carlos");
      expect(await enviar("Pérez")).toContain("apellido materno");

      expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
      const tramite = tramiteDe("lead-1")!;
      expect(tramite.consentimiento?.aceptado).toBe(true);
      expect(tramite.datos.nombres?.valor).toBe("Juan Carlos");
      expect(tramite.datos.apellido_paterno?.valor).toBe("Pérez");
      expect(tramite.datos.celular).toMatchObject({ valor: "7000000001", procedencia: "whatsapp" });
      expect(tramite.datos.empresa).toMatchObject({ valor: "ACME SA DE CV", procedencia: "precalificacion" });
      expect(tramite.datos.registro_patronal?.valor).toBe("A1234567890");
      expect(tramite.version).toBe(5);
      expect(leadsById.get("lead-1")).toMatchObject({
        estado: "nuevo",
        horario: "",
        nombre_infonavit: "JUAN CARLOS PEREZ LOPEZ",
      });
    });

    it("'no me interesa' dentro del trámite no marca no_interesado ni borra el avance", async () => {
      scraperContado();
      const p = "5217000000002";
      await llegarANss(p);
      await procesarYEvolucionar({ phone: p, textoUsuario: NSS });

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "no me interesa" });

      expect(reply).toBe(MSG_RECHAZO_OFERTA);
      expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
      expect(leadsById.get("lead-1")?.estado).toBe("nuevo");
      expect(tramiteDe("lead-1")?.etapa).toBe("rechazado");
    });

    it("reiniciar y volver a dar el mismo NSS reutiliza la precalificación y conserva lo capturado", async () => {
      const llamadas = scraperContado();
      const p = "5217000000003";
      const enviar = (texto: string) => procesarYEvolucionar({ phone: p, textoUsuario: texto });
      await llegarANss(p);
      await enviar(NSS);
      await enviar("sí");
      await enviar("sí");
      await enviar("Juan Carlos");

      await enviar("reiniciar");
      expect(conversationMemory.get(p)?.state).toBe("esperando_labor_vigente");
      for (const texto of ["Sí", "Sí", "No"]) await enviar(texto);
      expect(await enviar(NSS)).toContain("💰 $90,000");

      expect(llamadas).toHaveLength(1);
      const retomo = await enviar("sí");
      expect(retomo).toContain("apellido paterno");
      expect(retomo).not.toContain("¿Autorizas");
      expect(tramiteDe("lead-1")?.datos.nombres?.valor).toBe("Juan Carlos");
    });

    it("no lanza una segunda consulta al scraper mientras la primera sigue en curso", async () => {
      const llamadas = scraperContado();
      const p = "5217000000004";
      await llegarANss(p);
      const conv = conversationsStore.get(p)!;
      conversationsStore.set(p, {
        ...conv,
        data: { nssPendiente: NSS, consultaIniciadaAt: new Date().toISOString() },
      });

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: NSS });

      expect(reply).toBe(MSG_CONSULTA_EN_CURSO);
      expect(llamadas).toHaveLength(0);
      expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
    });

    it("una consulta 'en curso' vencida (instancia caída) sí se reintenta", async () => {
      const llamadas = scraperContado();
      const p = "5217000000005";
      await llegarANss(p);
      const conv = conversationsStore.get(p)!;
      conversationsStore.set(p, {
        ...conv,
        data: {
          nssPendiente: NSS,
          consultaIniciadaAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      });

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "ya?" });

      expect(reply).toContain("importe neto estimado");
      expect(llamadas).toHaveLength(1);
    });

    it("Compra de Casa no entra al trámite Mejoravit", async () => {
      const llamadas = scraperContado();
      const p = "5217000000006";
      conversationsStore.set(p, {
        state: "inicio",
        nss: null,
        lead_id: null,
        producto: "compra_casa",
        data: {},
      });

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });

      expect(reply).not.toContain("importe neto");
      expect(conversationsStore.get(p)?.state).not.toBe("tramite_mejoravit");
      expect(llamadas).toHaveLength(0);
    });
  });

  describe("comando de producto en el número 8114118767", () => {
    beforeEach(() => {
      vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", NUMERO_COMPARTIDO_PHONE_NUMBER_ID);
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Mismo orden que el webhook: liga/crea el lead y luego pasa el texto al bot. */
    async function mensajeEntrante(p: string, texto: string) {
      await ensureLeadProvisional(p, {
        phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
        primerMensaje: texto,
      });
      return procesarYEvolucionar({ phone: p, textoUsuario: texto });
    }

    it("casas → Mejoravit: el siguiente mensaje entra al flujo Mejoravit desde el inicio", async () => {
      const p = "5216000000001";
      expect(await mensajeEntrante(p, "Quiero vender mi casa")).toBe(
        "¿En qué municipio se encuentra?",
      );
      await mensajeEntrante(p, "Apodaca");
      expect(conversationsStore.get(p)?.data?.casaStep).toBe("colonia");

      const confirmacion = await aplicarComandoProducto(p, "mejoravit");

      expect(confirmacion).toBe(
        "Listo, a partir de ahora estamos para ayudarte con tu crédito Mejoravit.",
      );
      expect(conversationsStore.get(p)).toEqual({
        state: "inicio",
        nss: null,
        lead_id: "lead-1",
        producto: "mejoravit",
        data: { productoForzado: "mejoravit" },
      });
      expect(leadsById.get("lead-1")?.producto).toBe("mejoravit");
      expect(leadActionsRows).toContainEqual({
        lead_id: "lead-1",
        advisor_id: null,
        accion: "cambio_producto_automatico",
        nota: "comando: mejoravit",
      });

      const bienvenida = await mensajeEntrante(p, "Hola");
      expect(bienvenida).toContain("relación laboral vigente en Nuevo León");
      const infonavit = await mensajeEntrante(p, "Sí");
      expect(infonavit).toContain("dado de alta en Infonavit");
      expect(conversationsStore.get(p)?.producto).toBe("mejoravit");
    });

    it("Mejoravit finalizado → casas: arranca en la primera pregunta de casas", async () => {
      const p = "5216000000002";
      await mensajeEntrante(p, "Hola");
      await aplicarComandoProducto(p, "mejoravit");
      await mensajeEntrante(p, "Hola");
      const rechazo = await mensajeEntrante(p, "no");
      expect(rechazo).toContain("trabajadores activos en Nuevo León");
      expect(conversationsStore.get(p)?.state).toBe("finalizado");

      const confirmacion = await aplicarComandoProducto(p, "compra_casa");

      expect(confirmacion).toBe(
        "Listo, a partir de ahora estamos para ayudarte con la venta de tu propiedad.",
      );
      expect(await mensajeEntrante(p, "Hola")).toBe("¿En qué municipio se encuentra?");
      expect(conversationsStore.get(p)?.producto).toBe("compra_casa");
      expect(leadsById.get("lead-1")?.producto).toBe("compra_casa");
    });

    it("el comando sobre un lead sin asesor sincroniza el producto y asigna el asesor por defecto", async () => {
      const p = "5216000000010";
      await mensajeEntrante(p, "Hola");
      expect(leadsById.get("lead-1")).toMatchObject({ producto: "sin_clasificar" });
      expect(leadsById.get("lead-1")?.advisor_id).toBeUndefined();

      await aplicarComandoProducto(p, "compra_casa");

      expect(leadsById.get("lead-1")).toMatchObject({
        producto: "compra_casa",
        advisor_id: ADVISOR_ID_GUILLERMO,
      });
      expect(leadActionsRows).toEqual([
        {
          lead_id: "lead-1",
          advisor_id: null,
          accion: "cambio_producto_automatico",
          nota: "comando: compra_casa",
        },
        {
          lead_id: "lead-1",
          advisor_id: null,
          accion: "asesor_asignado_automatico",
          nota: `compra_casa: ${ADVISOR_ID_GUILLERMO}`,
        },
      ]);
    });

    it("el comando no reemplaza un asesor ya asignado", async () => {
      const p = "5216000000011";
      leadsById.set("lead-con-asesor", {
        id: "lead-con-asesor",
        whatsapp_phone: p,
        estado: "nuevo",
        producto: "compra_casa",
        advisor_id: "asesor-previo",
      });
      leadsByPhone.set(p, "lead-con-asesor");
      conversationsStore.set(p, {
        state: "inicio",
        nss: null,
        lead_id: "lead-con-asesor",
        producto: "compra_casa",
        data: {},
      });

      await aplicarComandoProducto(p, "mejoravit");

      expect(leadsById.get("lead-con-asesor")).toMatchObject({
        producto: "mejoravit",
        advisor_id: "asesor-previo",
      });
      expect(leadActionsRows.map((r) => r.accion)).toEqual(["cambio_producto_automatico"]);
    });

    it("reiniciar después del comando conserva Mejoravit y el lead_id en una sola escritura", async () => {
      const p = "5216000000003";
      await mensajeEntrante(p, "Hola");
      await aplicarComandoProducto(p, "mejoravit");
      await mensajeEntrante(p, "Hola");
      await mensajeEntrante(p, "Sí");

      const reinicio = await mensajeEntrante(p, "reiniciar");

      expect(reinicio).toContain("relación laboral vigente en Nuevo León");
      expect(conversationsStore.get(p)).toEqual({
        state: "esperando_labor_vigente",
        nss: null,
        lead_id: "lead-1",
        producto: "mejoravit",
        data: { productoForzado: "mejoravit" },
      });
      expect(leadsInsertRows).toHaveLength(1);
      expect(await mensajeEntrante(p, "Sí")).toContain("dado de alta en Infonavit");
    });

    it("comando sin lead_id y sin lead previo: el siguiente mensaje crea el lead sin deshacer el producto", async () => {
      const p = "5216000000004";

      await aplicarComandoProducto(p, "mejoravit");
      expect(conversationsStore.get(p)?.lead_id).toBeNull();

      const bienvenida = await mensajeEntrante(p, "Hola");

      expect(bienvenida).toContain("relación laboral vigente en Nuevo León");
      expect(conversationsStore.get(p)).toMatchObject({
        lead_id: "lead-1",
        producto: "mejoravit",
      });
      expect(leadsInsertRows[0]).toMatchObject({
        producto: "mejoravit",
        advisor_id: ADVISOR_ID_GUILLERMO,
      });
    });

    it("comando sin lead_id con lead previo: lo liga sin deshacer el producto", async () => {
      const p = "5216000000005";
      leadsById.set("lead-previo", { id: "lead-previo", whatsapp_phone: p, estado: "nuevo" });
      leadsByPhone.set(p, "lead-previo");

      await aplicarComandoProducto(p, "mejoravit");
      await mensajeEntrante(p, "Hola");
      const infonavit = await mensajeEntrante(p, "Sí");

      expect(infonavit).toContain("dado de alta en Infonavit");
      expect(conversationsStore.get(p)).toMatchObject({
        lead_id: "lead-previo",
        producto: "mejoravit",
      });
      expect(leadsInsertRows).toHaveLength(0);
    });

    it("sin comando, 'quiero vender mi casa' entra directo a casas con asesor por defecto", async () => {
      const p = "5216000000006";

      expect(await mensajeEntrante(p, "Hola, quiero vender mi casa")).toBe(
        "¿En qué municipio se encuentra?",
      );

      expect(conversationsStore.get(p)?.producto).toBe("compra_casa");
      expect(conversationsStore.get(p)?.data?.productoForzado).toBeUndefined();
      expect(leadsInsertRows[0]).toMatchObject({
        producto: "compra_casa",
        advisor_id: ADVISOR_ID_GUILLERMO,
      });
    });

    it("sin comando, un mensaje de Mejoravit entra directo al flujo Mejoravit", async () => {
      const p = "5216000000012";

      const bienvenida = await mensajeEntrante(p, "Información del crédito Mejoravit");

      expect(bienvenida).toContain("relación laboral vigente en Nuevo León");
      expect(conversationsStore.get(p)?.producto).toBe("mejoravit");
      expect(leadsInsertRows[0]).toMatchObject({
        producto: "mejoravit",
        advisor_id: ADVISOR_ID_GUILLERMO,
      });
    });

    it("sin comando, un mensaje de generadores entra a Generadores sin asesor automático", async () => {
      const p = "5216000000013";

      await mensajeEntrante(p, "¡Hola! Quiero más información de generadores para mi casa.");

      expect(conversationsStore.get(p)?.producto).toBe("generadores");
      expect(leadsInsertRows[0]).toMatchObject({ producto: "generadores" });
      expect(leadsInsertRows[0]).not.toHaveProperty("advisor_id");
      expect(leadActionsRows).toEqual([]);
    });

    describe("menú para mensajes ambiguos (sin_clasificar)", () => {
      it("primer mensaje ambiguo → lead sin_clasificar, sin asesor, y recibe el menú", async () => {
        const p = "5216000000014";

        expect(await mensajeEntrante(p, "Hola")).toBe(MSG_MENU_PRODUCTO);

        expect(conversationsStore.get(p)).toMatchObject({
          lead_id: "lead-1",
          producto: "sin_clasificar",
          data: { menuProductoEnviado: true },
        });
        expect(leadsInsertRows[0]).toMatchObject({ producto: "sin_clasificar" });
        expect(leadsInsertRows[0]).not.toHaveProperty("advisor_id");
      });

      it("el primer mensaje no se interpreta como respuesta al menú aunque mencione una opción", async () => {
        const p = "5216000000015";

        expect(await mensajeEntrante(p, "Me interesa la casa de la colonia Infonavit")).toBe(
          MSG_MENU_PRODUCTO,
        );
        expect(conversationsStore.get(p)?.producto).toBe("sin_clasificar");
      });

      it("responder '2' fija Compra de Casa en conversación y lead, asigna asesor y arranca casas", async () => {
        const p = "5216000000016";
        await mensajeEntrante(p, "Hola");

        const respuesta = await mensajeEntrante(p, "2");

        expect(respuesta).toBe("¿En qué municipio se encuentra?");
        expect(conversationsStore.get(p)).toMatchObject({
          lead_id: "lead-1",
          producto: "compra_casa",
          data: { casaStep: "municipio" },
        });
        expect(leadsById.get("lead-1")).toMatchObject({
          producto: "compra_casa",
          advisor_id: ADVISOR_ID_GUILLERMO,
        });
        expect(leadActionsRows.map((r) => [r.accion, r.nota, r.advisor_id])).toEqual([
          ["cambio_producto_automatico", "menu: compra_casa", null],
          ["asesor_asignado_automatico", `compra_casa: ${ADVISOR_ID_GUILLERMO}`, null],
        ]);
        expect(leadsInsertRows).toHaveLength(1);

        expect(await mensajeEntrante(p, "Apodaca")).toBe("¿En qué colonia se encuentra?");
      });

      it("responder '1' fija Mejoravit y arranca con la bienvenida de Mejoravit", async () => {
        const p = "5216000000017";
        await mensajeEntrante(p, "Buenas tardes");

        const bienvenida = await mensajeEntrante(p, "1");

        expect(bienvenida).toContain("relación laboral vigente en Nuevo León");
        expect(conversationsStore.get(p)?.producto).toBe("mejoravit");
        expect(leadsById.get("lead-1")).toMatchObject({
          producto: "mejoravit",
          advisor_id: ADVISOR_ID_GUILLERMO,
        });
        expect(await mensajeEntrante(p, "Sí")).toContain("dado de alta en Infonavit");
      });

      it("responder con el texto de la opción también la elige", async () => {
        const p = "5216000000018";
        await mensajeEntrante(p, "Hola");

        await mensajeEntrante(p, "Crédito Mejoravit");

        expect(conversationsStore.get(p)?.producto).toBe("mejoravit");
        expect(leadsById.get("lead-1")?.producto).toBe("mejoravit");
      });

      it("una respuesta no reconocida reenvía el menú sin clasificar ni asignar", async () => {
        const p = "5216000000019";
        await mensajeEntrante(p, "Hola");

        expect(await mensajeEntrante(p, "¿cuánto cuesta?")).toBe(MSG_MENU_PRODUCTO);

        expect(conversationsStore.get(p)?.producto).toBe("sin_clasificar");
        expect(leadsById.get("lead-1")?.producto).toBe("sin_clasificar");
        expect(leadsById.get("lead-1")?.advisor_id).toBeUndefined();
        expect(leadActionsRows).toEqual([]);
      });

      it("con DEFAULT_ADVISOR_MEJORAVIT configurada, el menú asigna a ese asesor", async () => {
        vi.stubEnv("DEFAULT_ADVISOR_MEJORAVIT", "asesor-mejoravit-uuid");
        const p = "5216000000020";
        await mensajeEntrante(p, "Hola");

        await mensajeEntrante(p, "1");

        expect(leadsById.get("lead-1")?.advisor_id).toBe("asesor-mejoravit-uuid");
      });
    });

    it("reiniciar una conversación Mejoravit antigua (sin comando) conserva Mejoravit, el lead y limpia el flujo", async () => {
      const p = "5216000000007";
      leadsById.set("lead-legacy", { id: "lead-legacy", whatsapp_phone: p, estado: "nuevo" });
      leadsByPhone.set(p, "lead-legacy");
      conversationsStore.set(p, {
        state: "esperando_horario",
        nss: "12345678901",
        lead_id: "lead-legacy",
        producto: "mejoravit",
        data: { nss: "12345678901", horario: "mañana" },
      });

      const reinicio = await procesarYEvolucionar({ phone: p, textoUsuario: "reiniciar" });

      expect(reinicio).toContain("relación laboral vigente en Nuevo León");
      expect(conversationsStore.get(p)).toEqual({
        state: "esperando_labor_vigente",
        nss: null,
        lead_id: "lead-legacy",
        producto: "mejoravit",
        data: {},
      });
      expect(leadsInsertRows).toHaveLength(0);
      expect(await mensajeEntrante(p, "Sí")).toContain("dado de alta en Infonavit");
      expect(conversationsStore.get(p)?.producto).toBe("mejoravit");
    });

    it("reiniciar una conversación Mejoravit antigua sin lead_id liga el lead existente sin duplicarlo", async () => {
      const p = "5216000000008";
      leadsById.set("lead-sin-ligar", { id: "lead-sin-ligar", whatsapp_phone: p, estado: "nuevo" });
      leadsByPhone.set(p, "lead-sin-ligar");
      conversationsStore.set(p, {
        state: "esperando_credito_activo",
        nss: null,
        lead_id: null,
        producto: "mejoravit",
        data: {},
      });

      await procesarYEvolucionar({ phone: p, textoUsuario: "reiniciar" });

      expect(conversationsStore.get(p)).toEqual({
        state: "esperando_labor_vigente",
        nss: null,
        lead_id: "lead-sin-ligar",
        producto: "mejoravit",
        data: {},
      });
      expect(leadsInsertRows).toHaveLength(0);
    });

    it("reiniciar una conversación Mejoravit sin ningún lead crea uno solo y conserva Mejoravit", async () => {
      const p = "5216000000009";
      conversationsStore.set(p, {
        state: "esperando_infonavit",
        nss: null,
        lead_id: null,
        producto: "mejoravit",
        data: {},
      });

      await procesarYEvolucionar({ phone: p, textoUsuario: "reiniciar" });
      await mensajeEntrante(p, "Sí");

      expect(leadsInsertRows).toHaveLength(1);
      expect(conversationsStore.get(p)).toMatchObject({
        lead_id: "lead-1",
        producto: "mejoravit",
        state: "esperando_infonavit",
      });
    });
  });

  describe("base de ConCasa antes y después de la precalificación", () => {
    const MAPS = "https://maps.app.goo.gl/dwKfVX3hWdjEEyM46";
    const PREGUNTAS: Array<[string, string]> = [
      ["¿Dónde están ubicados?", "Mariano Escobedo 574, Centro, C.P. 64000, Monterrey"],
      ["¿Puedo hacer el trámite directamente?", "Puedes realizar tu trámite directamente con Infonavit"],
      ["¿Dónde tengo que ir a biométricos?", "La primera cita presencial es para tus biométricos"],
      ["¿Qué pasa en Inscripción?", "Notificación e Inscripción son etapas"],
      ["¿Qué significa Notificación?", "Notificación e Inscripción son etapas"],
      ["¿Cuándo se agenda la firma?", "La cita de firma se coordina"],
      ["¿Cuánto cobran por acompañarme?", "Los trámites ante Infonavit son gratuitos"],
    ];
    const PASOS: Array<[string, string[], string]> = [
      ["esperando_labor_vigente", ["Hola"], MSG_PREGUNTA_LABOR],
      ["esperando_infonavit", ["Hola", "Sí"], MSG_INFONAVIT],
      ["esperando_credito_activo", ["Hola", "Sí", "Sí"], MSG_CREDITO_ACTIVO],
      ["esperando_datos", ["Hola", "Sí", "Sí", "No"], MSG_SOLICITUD_DATOS],
    ];

    function llamadasAlScraper(): number {
      return vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/precalificar")).length;
    }

    function fotografia(p: string) {
      return structuredClone({
        conversacion: conversationsStore.get(p),
        memoria: conversationMemory.get(p),
        lead: leadsById.get("lead-1"),
        actualizaciones: leadsUpdateRows.length,
        acciones: leadActionsRows.length,
        scraper: llamadasAlScraper(),
      });
    }

    for (const [estado, previos, pendiente] of PASOS) {
      it.each(PREGUNTAS)(`${estado}: "%s" se responde y retoma la pregunta sin cambiar nada`, async (pregunta, fragmento) => {
        const p = "5217000000001";
        for (const t of previos) await procesarYEvolucionar({ phone: p, textoUsuario: t });
        expect(conversationMemory.get(p)?.state).toBe(estado);
        const antes = fotografia(p);

        const reply = await procesarYEvolucionar({ phone: p, textoUsuario: pregunta });

        expect(reply).toContain(fragmento);
        expect(reply!.indexOf(fragmento)).toBeLessThan(reply!.indexOf(pendiente));
        expect(reply!.endsWith(pendiente)).toBe(true);
        expect(reply).not.toContain("Buenas tardes, gracias por contactarnos");
        expect(reply).not.toMatch(/18\s?%/);
        expect(fotografia(p)).toEqual(antes);
      });
    }

    it("primer mensaje con pregunta: responde la ubicación y después da la bienvenida", async () => {
      const p = "5217000000002";
      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "¿Dónde están ubicados?" });

      expect(reply!.startsWith("Nuestra oficina de ConCasa está en Mariano Escobedo 574")).toBe(true);
      expect(reply).toContain(MAPS);
      expect(reply!.endsWith(MSG_BIENVENIDA)).toBe(true);
      expect(conversationMemory.get(p)?.state).toBe("esperando_labor_vigente");
    });

    it("con el NSS ya capturado y la consulta pendiente: no lo vuelve a pedir ni reintenta la consulta", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          String(input).includes("/precalificar")
            ? new Response(JSON.stringify({ success: true, datos: {} }), { status: 200 })
            : new Response("{}", { status: 200 }),
        ),
      );
      const p = "5217000000003";
      await llegarANss(p);
      expect(await procesarYEvolucionar({ phone: p, textoUsuario: "12345678901" })).toBe(MSG_CONSULTA_NO_DISPONIBLE);
      const antes = fotografia(p);

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "¿Dónde están ubicados?" });

      expect(reply).toContain(MAPS);
      expect(reply!.endsWith(MSG_NSS_EN_ESPERA)).toBe(true);
      expect(reply).not.toContain("Compárteme tu Número de Seguro Social");
      expect(fotografia(p)).toEqual(antes);
      expect(conversationMemory.get(p)?.data?.nssPendiente).toBe("12345678901");
      errorSpy.mockRestore();
    });

    it("una pregunta con 'ya no' no se toma como opt-out", async () => {
      const p = "5217000000004";
      await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "¿Ya no tienen oficina en el centro?" });

      expect(reply).toContain(MAPS);
      expect(conversationMemory.get(p)?.state).toBe("esperando_labor_vigente");
      expect(leadsUpdateRows.some((u) => u.patch.estado === "no_interesado")).toBe(false);
    });

    it("respuesta y pregunta en el mismo mensaje: avanza el paso y responde primero la duda", async () => {
      const p = "5217000000005";
      await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "Sí, ¿dónde están ubicados?" });

      expect(conversationMemory.get(p)?.state).toBe("esperando_infonavit");
      expect(reply!.startsWith("Nuestra oficina de ConCasa")).toBe(true);
      expect(reply!.endsWith(MSG_INFONAVIT)).toBe(true);
    });

    it("antes de precalificar no menciona importes al preguntar si ya está aprobado", async () => {
      const p = "5217000000006";
      await llegarANss(p);

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "¿Mi crédito ya está aprobado?" });

      expect(reply).toContain("Primero hacemos tu precalificación");
      expect(reply).not.toMatch(/\$\d/);
      expect(reply!.endsWith(MSG_SOLICITUD_DATOS)).toBe(true);
    });

    it.each(PREGUNTAS)('después de precalificar: "%s" se responde en el trámite y retoma la oferta', async (pregunta, fragmento) => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const p = "5217000000007";
      for (const paso of FLUJO_SI) await procesarYEvolucionar({ phone: p, textoUsuario: paso });
      expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
      const tramiteAntes = leadsById.get("lead-1")!.tramite_mejoravit as TramiteMejoravit;
      const scraper = llamadasAlScraper();

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: pregunta });

      expect(reply).toContain(fragmento);
      expect(reply!.endsWith("¿Te gustaría continuar con tu trámite?")).toBe(true);
      const tramite = leadsById.get("lead-1")!.tramite_mejoravit as TramiteMejoravit;
      expect(tramite.etapa).toBe("oferta");
      expect(tramite.datos).toEqual(tramiteAntes.datos);
      expect(tramite.credito).toEqual(tramiteAntes.credito);
      expect(conversationMemory.get(p)?.state).toBe("tramite_mejoravit");
      expect(llamadasAlScraper()).toBe(scraper);
    });

    it("Compra de Casa no usa la base de ConCasa", async () => {
      const p = "5217000000008";
      conversationsStore.set(p, { state: "inicio", nss: null, lead_id: null, producto: "compra_casa", data: {} });

      const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "¿Dónde están ubicados?" });

      expect(reply ?? "").not.toMatch(/ConCasa|Mariano Escobedo|maps\.app\.goo\.gl/);
    });
  });
});
