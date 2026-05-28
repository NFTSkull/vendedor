import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCrmAuth: vi.fn(),
  enviarMensajeTextoWa: vi.fn(),
  guardarMensaje: vi.fn(),
  listarMensajesPorLead: vi.fn(),
  maybeSingleLead: vi.fn(),
  insertLeadAction: vi.fn(),
}));

vi.mock("@/lib/crmAuth", () => ({
  requireCrmAuth: mocks.requireCrmAuth,
}));

vi.mock("@/lib/whatsappCloud", () => ({
  enviarMensajeTextoWa: mocks.enviarMensajeTextoWa,
}));

vi.mock("@/lib/messagesDb", () => ({
  guardarMensaje: mocks.guardarMensaje,
  listarMensajesPorLead: mocks.listarMensajesPorLead,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "leads") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mocks.maybeSingleLead,
            }),
          }),
        };
      }
      if (table === "lead_actions") {
        return {
          insert: mocks.insertLeadAction,
        };
      }
      return {};
    },
  }),
}));

import { POST } from "@/app/api/crm/leads/[id]/messages/route";

describe("POST /api/crm/leads/[id]/messages", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v19.0";

    mocks.requireCrmAuth.mockResolvedValue({ sub: "advisor-1" });
    mocks.enviarMensajeTextoWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
    mocks.insertLeadAction.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("permite enviar mensaje cuando el lead está en estado nuevo", async () => {
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-1", whatsapp_phone: "5215550000000", estado: "nuevo" },
      error: null,
    });

    const req = new Request("http://localhost/api/crm/leads/lead-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje: "Hola desde CRM" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "lead-1" }) });

    expect(res.status).toBe(200);
    expect(mocks.enviarMensajeTextoWa).toHaveBeenCalledTimes(1);
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-1",
      direccion: "saliente",
      contenido: "Hola desde CRM",
    });
  });

  it("bloquea estados fuera de nuevo/contactado/no_interesado", async () => {
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-2", whatsapp_phone: "5215550000000", estado: "archivado" },
      error: null,
    });

    const req = new Request("http://localhost/api/crm/leads/lead-2/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje: "Hola" }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "lead-2" }) });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("no permite");
    expect(mocks.enviarMensajeTextoWa).not.toHaveBeenCalled();
  });
});
