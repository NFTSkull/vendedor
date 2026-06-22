import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCrmAuth: vi.fn(),
  leadsData: [] as Record<string, unknown>[],
  messagesData: [] as Record<string, unknown>[],
  advisorEmail: "bernard@example.com",
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
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({ data: mocks.leadsData, error: null }),
            }),
          }),
        };
      }

      if (table === "messages") {
        return {
          select: () => ({
            in: () => ({
              order: () =>
                Promise.resolve({ data: mocks.messagesData, error: null }),
            }),
          }),
        };
      }

      return {};
    },
  }),
}));

import { GET } from "@/app/api/crm/leads/route";

function getLeads(producto = "generadores") {
  return GET(
    new Request(`http://localhost/api/crm/leads?producto=${producto}`, {
      headers: { Authorization: "Bearer token" },
    }),
  );
}

describe("GET /api/crm/leads", () => {
  beforeEach(() => {
    mocks.requireCrmAuth.mockResolvedValue({ sub: "advisor-1" });
    mocks.advisorEmail = "bernard@example.com";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ordena por ultima_actividad_at DESC (estilo WhatsApp)", async () => {
    mocks.leadsData = [
      {
        id: "lead-a",
        created_at: "2026-06-09T08:00:00Z",
        advisor_id: "advisor-1",
        producto: "generadores",
        whatsapp_phone: "5215550000001",
        estado: "contactado",
      },
      {
        id: "lead-b",
        created_at: "2026-06-10T08:00:00Z",
        advisor_id: "advisor-1",
        producto: "generadores",
        whatsapp_phone: "5215550000002",
        estado: "contactado",
      },
      {
        id: "lead-c",
        created_at: "2026-06-10T12:00:00Z",
        advisor_id: "advisor-1",
        producto: "generadores",
        whatsapp_phone: "5215550000003",
        estado: "nuevo",
      },
    ];

    mocks.messagesData = [
      {
        lead_id: "lead-a",
        contenido: "Cotización enviada",
        created_at: "2026-06-10T10:00:00Z",
        direccion: "saliente",
      },
      {
        lead_id: "lead-b",
        contenido: "Hola",
        created_at: "2026-06-10T08:00:00Z",
        direccion: "entrante",
      },
    ];

    const res = await getLeads();
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{
      id: string;
      ultima_actividad_at: string;
    }>;

    expect(body.map((l) => l.id)).toEqual(["lead-c", "lead-a", "lead-b"]);
    expect(body[1]?.ultima_actividad_at).toBe("2026-06-10T10:00:00Z");
    expect(body[2]?.ultima_actividad_at).toBe("2026-06-10T08:00:00Z");
  });
});
