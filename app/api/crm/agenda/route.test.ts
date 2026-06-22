import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCrmAuth: vi.fn(),
  leadsData: [] as Record<string, unknown>[],
  advisorEmail: "bernard@example.com",
  authSub: "advisor-1",
  lastEstadoFilter: null as string[] | null,
  lastProductoFilter: null as string | null,
  lastAdvisorFilter: null as { type: "is" | "eq"; value: string | null } | null,
}));

vi.mock("@/lib/crmAuth", () => ({
  requireCrmAuth: mocks.requireCrmAuth,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "advisors") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { email: mocks.advisorEmail },
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === "leads") {
        const resolveLeads = () =>
          Promise.resolve({ data: mocks.leadsData, error: null });

        return {
          select: () => {
            const chain = {
              in: (_col: string, estados: string[]) => {
                mocks.lastEstadoFilter = estados;
                return chain;
              },
              eq: (col: string, val: string) => {
                if (col === "producto") mocks.lastProductoFilter = val;
                if (col === "advisor_id") {
                  mocks.lastAdvisorFilter = { type: "eq", value: val };
                  return resolveLeads();
                }
                return chain;
              },
              is: (col: string, val: null) => {
                if (col === "advisor_id") {
                  mocks.lastAdvisorFilter = { type: "is", value: val };
                }
                return resolveLeads();
              },
            };
            return chain;
          },
        };
      }

      return {};
    },
  }),
}));

import { GET } from "@/app/api/crm/agenda/route";

function getAgenda(producto = "generadores", token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return GET(
    new Request(`http://localhost/api/crm/agenda?producto=${producto}`, {
      headers,
    }),
  );
}

describe("GET /api/crm/agenda", () => {
  beforeEach(() => {
    mocks.requireCrmAuth.mockResolvedValue({ sub: "advisor-1" });
    mocks.advisorEmail = "bernard@example.com";
    mocks.authSub = "advisor-1";
    mocks.leadsData = [];
    mocks.lastEstadoFilter = null;
    mocks.lastProductoFilter = null;
    mocks.lastAdvisorFilter = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sin auth → 401", async () => {
    mocks.requireCrmAuth.mockResolvedValue(null);
    const res = await getAgenda("generadores", "token");
    expect(res.status).toBe(401);
  });

  it("con auth admin filtra advisor_id null", async () => {
    mocks.advisorEmail = "admin@mejoravit.com";
    mocks.leadsData = [
      {
        id: "l1",
        whatsapp_phone: "5215550000001",
        producto: "generadores",
        estado: "nuevo",
        fecha_contacto: null,
        horario: null,
        nota: null,
        advisor_id: null,
        created_at: "2026-06-18T10:00:00Z",
      },
    ];

    const res = await getAgenda("generadores");
    expect(res.status).toBe(200);
    expect(mocks.lastAdvisorFilter).toEqual({ type: "is", value: null });
    expect(mocks.lastEstadoFilter).toEqual(["nuevo", "contactado"]);
    expect(mocks.lastProductoFilter).toBe("generadores");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("vencidos");
    expect(body).toHaveProperty("hoy");
    expect(body).toHaveProperty("manana");
    expect(body).toHaveProperty("esta_semana");
    expect(body).toHaveProperty("futuros");
    expect(body).toHaveProperty("sin_agendar");
    expect(body).toHaveProperty("counts");
  });

  it("con auth Bernardo filtra solo sus leads", async () => {
    mocks.leadsData = [
      {
        id: "l2",
        whatsapp_phone: "5215550000002",
        producto: "generadores",
        estado: "contactado",
        fecha_contacto: "2026-06-20T18:00:00.000Z",
        horario: "Martes 10am",
        nota: null,
        advisor_id: "advisor-1",
        created_at: "2026-06-01T10:00:00Z",
      },
    ];

    const res = await getAgenda("generadores");
    expect(res.status).toBe(200);
    expect(mocks.lastAdvisorFilter).toEqual({ type: "eq", value: "advisor-1" });
  });

  it("agrupa leads en buckets con counts", async () => {
    mocks.leadsData = [
      {
        id: "sin",
        whatsapp_phone: "5215550000003",
        producto: "generadores",
        estado: "nuevo",
        fecha_contacto: null,
        horario: "Cualquier día",
        nota: null,
        advisor_id: "advisor-1",
        created_at: "2026-06-18T10:00:00Z",
      },
    ];

    const res = await getAgenda("generadores");
    const body = (await res.json()) as {
      sin_agendar: { id: string }[];
      counts: { sin_agendar: number };
    };

    expect(body.sin_agendar).toHaveLength(1);
    expect(body.counts.sin_agendar).toBe(1);
  });
});
