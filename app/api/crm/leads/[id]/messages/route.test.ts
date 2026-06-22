import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCrmAuth: vi.fn(),
  enviarMensajeTextoWa: vi.fn(),
  guardarMensaje: vi.fn(),
  listarMensajesPorLead: vi.fn(),
  maybeSingleLead: vi.fn(),
  insertLeadAction: vi.fn(),
  updateLeadEstado: vi.fn(),
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
          update: (payload: Record<string, unknown>) => ({
            eq: () => mocks.updateLeadEstado(payload),
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

function postMensaje(leadId: string, mensaje: string) {
  return POST(
    new Request(`http://localhost/api/crm/leads/${leadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje }),
    }),
    { params: Promise.resolve({ id: leadId }) },
  );
}

describe("POST /api/crm/leads/[id]/messages", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v19.0";

    mocks.requireCrmAuth.mockResolvedValue({ sub: "advisor-1" });
    mocks.enviarMensajeTextoWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
    mocks.insertLeadAction.mockResolvedValue({ error: null });
    mocks.updateLeadEstado.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lead en nuevo + envío exitoso → contactado + ambos lead_actions", async () => {
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-1", whatsapp_phone: "5215550000000", estado: "nuevo" },
      error: null,
    });

    const res = await postMensaje("lead-1", "Hola desde CRM");

    expect(res.status).toBe(200);
    expect(mocks.updateLeadEstado).toHaveBeenCalledWith({ estado: "contactado" });
    expect(mocks.insertLeadAction).toHaveBeenCalledTimes(2);
    expect(mocks.insertLeadAction).toHaveBeenNthCalledWith(1, {
      lead_id: "lead-1",
      advisor_id: "advisor-1",
      accion: "mensaje_asesor",
      nota: "Hola desde CRM",
    });
    expect(mocks.insertLeadAction).toHaveBeenNthCalledWith(2, {
      lead_id: "lead-1",
      advisor_id: "advisor-1",
      accion: "cambio_estado_automatico",
      nota: "Marcado automáticamente como contactado (asesor envió mensaje)",
    });
  });

  it("lead en contactado + envío exitoso → sin update de estado", async () => {
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-1", whatsapp_phone: "5215550000000", estado: "contactado" },
      error: null,
    });

    const res = await postMensaje("lead-1", "Seguimiento");

    expect(res.status).toBe(200);
    expect(mocks.updateLeadEstado).not.toHaveBeenCalled();
    expect(mocks.insertLeadAction).toHaveBeenCalledTimes(1);
    expect(mocks.insertLeadAction).toHaveBeenCalledWith({
      lead_id: "lead-1",
      advisor_id: "advisor-1",
      accion: "mensaje_asesor",
      nota: "Seguimiento",
    });
  });

  it("lead en no_interesado + envío exitoso → estado no cambia", async () => {
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-1", whatsapp_phone: "5215550000000", estado: "no_interesado" },
      error: null,
    });

    const res = await postMensaje("lead-1", "Último intento");

    expect(res.status).toBe(200);
    expect(mocks.updateLeadEstado).not.toHaveBeenCalled();
    expect(mocks.insertLeadAction).toHaveBeenCalledTimes(1);
    expect(mocks.insertLeadAction).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "mensaje_asesor" }),
    );
  });

  it("lead en nuevo + WhatsApp falla → estado sigue nuevo", async () => {
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-1", whatsapp_phone: "5215550000000", estado: "nuevo" },
      error: null,
    });
    mocks.enviarMensajeTextoWa.mockResolvedValue({
      ok: false,
      status: 502,
      data: { error: "fail" },
    });

    const res = await postMensaje("lead-1", "Hola");

    expect(res.status).toBe(502);
    expect(mocks.guardarMensaje).not.toHaveBeenCalled();
    expect(mocks.updateLeadEstado).not.toHaveBeenCalled();
    expect(mocks.insertLeadAction).not.toHaveBeenCalled();
  });

  it("bloquea estados fuera de nuevo/contactado/no_interesado", async () => {
    mocks.maybeSingleLead.mockResolvedValue({
      data: { id: "lead-2", whatsapp_phone: "5215550000000", estado: "archivado" },
      error: null,
    });

    const res = await postMensaje("lead-2", "Hola");
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("no permite");
    expect(mocks.enviarMensajeTextoWa).not.toHaveBeenCalled();
  });
});
