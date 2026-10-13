import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { procesarYEvolucionar } from "@/lib/botSteps";
import { MSG_CONSULTA_NO_DISPONIBLE } from "@/lib/botStepsCore";
import { aplicarComandoProducto } from "@/lib/comandoProducto";
import { conversationMemory } from "@/lib/conversationMemory";
import { COMPRA_CASA_PHONE_NUMBER_ID } from "@/lib/detectarProducto";
import { ensureLeadProvisional } from "@/lib/leadProvisional";

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
            id: val,
            whatsapp_phone: row.whatsapp_phone,
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
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              leadsUpdateRows.push({ id, patch });
              const current = leadsById.get(id);
              if (current) leadsById.set(id, { ...current, ...patch });
              return { error: null };
            },
          }),
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
  "Martes 10am",
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
    leadCounter = 0;
  });

  it("crea lead provisional en el primer mensaje y lo actualiza al cerrar", async () => {
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
    expect(
      leadsUpdateRows.some(
        (u) => u.patch.horario === "Martes 10am" && u.patch.nss === "12345678901",
      ),
    ).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("[Supabase] Lead actualizado:", {
      phone: p,
      nss: "12345678901",
      horario: "Martes 10am",
      lead_id: "lead-1",
    });
    expect(leadsUpdateRows.some((u) => u.patch.nss === "12345678901")).toBe(true);
    expect(leadsUpdateRows.some((u) => u.patch.horario === "Martes 10am")).toBe(true);

    logSpy.mockRestore();
  });

  it("flujo completo hasta cierre con asesor y logea lead", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const p = "5211111111111";
    let reply: string | null = null;

    for (const paso of FLUJO_SI) {
      reply = await procesarYEvolucionar({ phone: p, textoUsuario: paso });
      expect(reply).toBeTruthy();
    }

    expect(reply).toContain("Listo, un asesor te contactará Martes 10am");
    expect(reply).toContain("8140100246");
    expect(reply).not.toContain("8114118767");

    expect(logSpy).toHaveBeenCalledWith("[lead confirmado]", {
      phone: p,
      name: null,
      nss: "12345678901",
      lead_id: "lead-1",
    });

    expect(leadsUpdateRows.some((u) => u.patch.saldo_subcuenta === 100000)).toBe(
      true,
    );
    expect(leadsUpdateRows.some((u) => u.patch.monto_credito === 85000)).toBe(
      true,
    );

    const ultimaActualizacion = leadsUpdateRows[leadsUpdateRows.length - 1];
    expect(ultimaActualizacion.patch).toMatchObject({
      nss: "12345678901",
      horario: "Martes 10am",
      estado: "nuevo",
    });

    logSpy.mockRestore();
  });

  it("consulta scraper y muestra monto exacto al cerrar el flujo", async () => {
    const p = "5233333333333";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });

    const replyNss = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "09876543210",
    });

    expect(replyNss).toContain("Tu monto autorizado es:");
    expect(replyNss).toContain("$100,000");
    expect(replyNss).toContain("¿Te podemos contactar ahorita mismo");
    expect(conversationMemory.get(p)?.state).toBe("esperando_horario");

    const replyHorario = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "Martes 10am",
    });

    expect(replyHorario).toContain("Listo, un asesor te contactará Martes 10am");
    expect(replyHorario).toContain("8140100246");
    expect(conversationMemory.get(p)?.state).toBe("finalizado");
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

      expect(reply).toContain("Tu monto autorizado es:");
      expect(conversationMemory.get(p)?.state).toBe("esperando_horario");
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

    expect(replyNss).toContain("Tu monto autorizado es:");
    expect(replyNss).toContain("$100,000");
    expect(conversationMemory.get(p)?.state).toBe("esperando_horario");

    await procesarYEvolucionar({ phone: p, textoUsuario: "Martes 10am" });
    expect(conversationMemory.get(p)?.state).toBe("finalizado");
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

  it("con NSS guardado no pide NSS de nuevo al capturar horario", async () => {
    const p = "5212121212121";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "12345678901" });

    expect(conversationMemory.get(p)?.state).toBe("esperando_horario");

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "Mañana a las 11am",
    });

    expect(reply).not.toContain("Compárteme tu Número de Seguro Social");
    expect(reply).toContain("Tu monto autorizado es:");
    expect(reply).toContain("Listo, un asesor te contactará Mañana a las 11am");
    expect(conversationMemory.get(p)?.state).toBe("finalizado");
  });

  it("con NSS solo en lead finaliza con monto al capturar horario", async () => {
    const p = "5213131313131";
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
      nss: "43119209344",
      horario: "",
    });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "Mañana a las 11am",
    });

    expect(reply).not.toContain("Compárteme tu Número de Seguro Social");
    expect(reply).toContain("Tu monto autorizado es:");
    expect(conversationMemory.get(p)?.state).toBe("finalizado");
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

  describe("comando de producto en el número 8114118767", () => {
    beforeEach(() => {
      vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", COMPRA_CASA_PHONE_NUMBER_ID);
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Mismo orden que el webhook: liga/crea el lead y luego pasa el texto al bot. */
    async function mensajeEntrante(p: string, texto: string) {
      await ensureLeadProvisional(p, {
        phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
        primerMensaje: texto,
      });
      return procesarYEvolucionar({ phone: p, textoUsuario: texto });
    }

    it("casas → Mejoravit: el siguiente mensaje entra al flujo Mejoravit desde el inicio", async () => {
      const p = "5216000000001";
      expect(await mensajeEntrante(p, "Hola")).toBe("¿En qué municipio se encuentra?");
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
      expect(leadsInsertRows[0]).toMatchObject({ producto: "compra_casa" });
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

    it("sin comando, un lead nuevo en el número sigue entrando a casas", async () => {
      const p = "5216000000006";

      expect(await mensajeEntrante(p, "Hola")).toBe("¿En qué municipio se encuentra?");

      expect(conversationsStore.get(p)?.producto).toBe("compra_casa");
      expect(conversationsStore.get(p)?.data?.productoForzado).toBeUndefined();
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
});
