import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { procesarYEvolucionar } from "@/lib/botSteps";
import { conversationMemory } from "@/lib/conversationMemory";

const conversationsStore = new Map<
  string,
  {
    state: string;
    nss: string | null;
    lead_id: string | null;
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
            data?: Record<string, unknown>;
          }) => {
            const prev = conversationsStore.get(row.whatsapp_phone);
            conversationsStore.set(row.whatsapp_phone, {
              state: row.state,
              nss: row.nss,
              lead_id:
                row.lead_id !== undefined ? row.lead_id : (prev?.lead_id ?? null),
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

const FLUJO_SI = [
  "Hola",
  "si",
  "SI",
  "no",
  "Martes 10am",
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

    expect(reply).toContain("Un asesor se pondrá en contacto contigo pronto");
    expect(reply).not.toContain("8140100246");
    expect(reply).not.toContain("8114118767");

    expect(logSpy).toHaveBeenCalledWith("[lead confirmado]", {
      phone: p,
      name: null,
      nss: "12345678901",
      lead_id: "lead-1",
    });

    const ultimaActualizacion = leadsUpdateRows[leadsUpdateRows.length - 1];
    expect(ultimaActualizacion.patch).toMatchObject({
      nss: "12345678901",
      horario: "Martes 10am",
      estado: "nuevo",
      saldo_subcuenta: 100000,
      monto_base: 100000,
      monto_credito: 85000,
      monto_aprobado_min: 100000,
      monto_aprobado_max: 100000,
    });

    logSpy.mockRestore();
  });

  it("consulta scraper y muestra monto exacto al cerrar el flujo", async () => {
    const p = "5233333333333";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Martes 10am" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "09876543210",
    });

    expect(reply).toContain("Tu monto autorizado es:");
    expect(reply).toContain("$100,000");
    expect(reply).toContain("Un asesor se pondrá en contacto contigo pronto");
    expect(reply).not.toContain("día y horario");
  });

  it("pide reingresar NSS cuando la precalificación no devuelve datos válidos", async () => {
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
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Martes 10am" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "12345678901",
    });

    expect(reply).toContain("comparte nuevamente tu número de seguro social");
    expect(reply).not.toContain("problema");
    expect(reply).not.toContain("error");
    expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
  });

  it("pide reingresar NSS cuando falla la consulta al scraper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/precalificar")) {
          throw new Error("timeout");
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const p = "5266666666666";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Martes 10am" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "12345678901",
    });

    expect(reply).toContain("comparte nuevamente tu número de seguro social");
    expect(reply).not.toContain("problema");
    expect(reply).not.toContain("error");
    expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
  });

  it("rechaza sin relación laboral vigente", async () => {
    const p = "5244444444444";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "no" });

    expect(reply).toContain("relación laboral vigente en Nuevo León");
    expect(reply).not.toContain(
      "Para revisar si puedes continuar con tu trámite",
    );
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
    await procesarYEvolucionar({ phone: p, textoUsuario: "Martes 10am" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "01234567890",
    });

    expect(reply).toContain("Tu monto autorizado es:");
    expect(reply).toContain("$100,000");
    expect(conversationMemory.get(p)?.state).toBe("finalizado");
  });

  it("rechaza NSS cuando trae más de 11 dígitos", async () => {
    const p = "5210101010101";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Martes 10am" });

    const reply = await procesarYEvolucionar({
      phone: p,
      textoUsuario: "123456789012",
    });

    expect(reply).toContain("11 dígitos");
    expect(conversationMemory.get(p)?.state).toBe("esperando_datos");
    expect(conversationMemory.get(p)?.nss).toBeNull();
  });

  it("rechaza crédito Infonavit activo", async () => {
    const p = "5255555555555";
    await procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    const reply = await procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    expect(reply).toContain("termines de pagar tu crédito Infonavit");
  });
});
