import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extraerTextosEntrantes: vi.fn(),
  buscarLeadPorTelefono: vi.fn(),
  buscarLeadPorId: vi.fn(),
  guardarMensaje: vi.fn(),
  getConversation: vi.fn(),
  ensureLeadProvisional: vi.fn(),
  enviarPushNuevoLead: vi.fn(),
  procesarYEvolucionar: vi.fn(),
  enviarMensajeTextoWa: vi.fn(),
}));

vi.mock("@/lib/parseWhatsAppWebhook", () => ({
  extraerTextosEntrantes: mocks.extraerTextosEntrantes,
}));

vi.mock("@/lib/messagesDb", () => ({
  buscarLeadPorTelefono: mocks.buscarLeadPorTelefono,
  buscarLeadPorId: mocks.buscarLeadPorId,
  guardarMensaje: mocks.guardarMensaje,
}));

vi.mock("@/lib/conversationMemory", () => ({
  getConversation: mocks.getConversation,
}));

vi.mock("@/lib/leadProvisional", () => ({
  ensureLeadProvisional: mocks.ensureLeadProvisional,
}));

vi.mock("@/lib/pushNotifications", () => ({
  enviarPushNuevoLead: mocks.enviarPushNuevoLead,
}));

vi.mock("@/lib/botSteps", () => ({
  procesarYEvolucionar: mocks.procesarYEvolucionar,
}));

vi.mock("@/lib/whatsappCloud", () => ({
  enviarMensajeTextoWa: mocks.enviarMensajeTextoWa,
}));

vi.mock("@/lib/metaWebhookVerification", () => ({
  getMetaWebhookVerificationResponse: vi.fn(),
}));

import { POST } from "@/app/api/webhook/route";

describe("POST /api/webhook", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    process.env.WHATSAPP_GRAPH_API_VERSION = "v19.0";

    mocks.extraerTextosEntrantes.mockReturnValue([
      { from: "5215550000000", body: "Hola", wamid: "wamid.1" },
    ]);
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
    });
    mocks.ensureLeadProvisional.mockResolvedValue("lead-1");
    mocks.enviarPushNuevoLead.mockResolvedValue(undefined);
    mocks.buscarLeadPorTelefono.mockResolvedValue(null);
    mocks.buscarLeadPorId.mockResolvedValue({
      id: "lead-1",
      whatsapp_phone: "5215550000000",
      estado: "nuevo",
    });
    mocks.procesarYEvolucionar.mockResolvedValue("Respuesta del bot");
    mocks.enviarMensajeTextoWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("guarda mensaje entrante usando lead_id de la conversación", async () => {
    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(mocks.ensureLeadProvisional).toHaveBeenCalledWith("5215550000000");
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-1",
      direccion: "entrante",
      contenido: "Hola",
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-1",
      direccion: "saliente",
      contenido: "Respuesta del bot",
    });
  });

  it("guarda entrante cuando el lead se crea durante el flujo", async () => {
    mocks.extraerTextosEntrantes.mockReturnValue([
      { from: "5215550000000", body: "Hola", wamid: "wamid.2" },
    ]);
    mocks.getConversation
      .mockResolvedValueOnce({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: null,
      })
      .mockResolvedValue({
        state: "esperando_labor_vigente",
        name: null,
        nss: null,
        lead_id: "lead-recien-creado",
      });
    mocks.ensureLeadProvisional.mockResolvedValue("lead-recien-creado");
    mocks.buscarLeadPorId.mockResolvedValue({
      id: "lead-recien-creado",
      whatsapp_phone: "5215550000000",
      estado: "nuevo",
    });

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-recien-creado",
      direccion: "entrante",
      contenido: "Hola",
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-recien-creado",
      direccion: "saliente",
      contenido: "Respuesta del bot",
    });
  });

  it("persiste también el mensaje automático de espera cuando aplica", async () => {
    mocks.extraerTextosEntrantes.mockReturnValue([
      {
        from: "5215550000000",
        body: "Mi NSS es 12345678901",
        wamid: "wamid.3",
      },
    ]);
    mocks.getConversation.mockResolvedValue({
      state: "esperando_datos",
      name: null,
      nss: null,
      lead_id: "lead-3",
    });
    mocks.ensureLeadProvisional.mockResolvedValue("lead-3");
    mocks.buscarLeadPorId.mockResolvedValue({
      id: "lead-3",
      whatsapp_phone: "5215550000000",
      estado: "nuevo",
    });

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(mocks.enviarMensajeTextoWa).toHaveBeenCalledTimes(2);
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-3",
      direccion: "saliente",
      contenido: "Un momento, estoy consultando tu información en Infonavit... ⏳",
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-3",
      direccion: "saliente",
      contenido: "Respuesta del bot",
    });
  });
});
