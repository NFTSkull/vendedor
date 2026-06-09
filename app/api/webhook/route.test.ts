import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extraerTextosEntrantes: vi.fn(),
  payloadDebeIgnorarPorEcos: vi.fn(),
  resolveWhatsAppAccount: vi.fn(),
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
  payloadDebeIgnorarPorEcos: mocks.payloadDebeIgnorarPorEcos,
}));

vi.mock("@/lib/whatsappAccountResolver", () => ({
  resolveWhatsAppAccount: mocks.resolveWhatsAppAccount,
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
    delete process.env.WHATSAPP_MULTI_NUMBER_ENABLED;

    mocks.payloadDebeIgnorarPorEcos.mockReturnValue(false);
    mocks.resolveWhatsAppAccount.mockResolvedValue(null);
    mocks.extraerTextosEntrantes.mockReturnValue([
      { from: "5215550000000", body: "Hola", wamid: "wamid.1", phoneNumberId: null },
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
    expect(mocks.ensureLeadProvisional).toHaveBeenCalledWith("5215550000000", {
      phoneNumberId: "phone-id",
      primerMensaje: "Hola",
    });
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
      { from: "5215550000000", body: "Hola", wamid: "wamid.2", phoneNumberId: null },
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
        phoneNumberId: null,
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

  it("con multi-número desactivado no llama al resolver", async () => {
    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });

    await POST(req as never);

    expect(mocks.resolveWhatsAppAccount).not.toHaveBeenCalled();
    expect(mocks.enviarMensajeTextoWa).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: "phone-id",
        accessToken: "token",
      }),
    );
  });

  it("con multi-número activo usa credenciales resueltas por phone_number_id", async () => {
    process.env.WHATSAPP_MULTI_NUMBER_ENABLED = "true";
    mocks.extraerTextosEntrantes.mockReturnValue([
      {
        from: "5215550000000",
        body: "Hola",
        wamid: "wamid.multi",
        phoneNumberId: "jefe-phone-id",
      },
    ]);
    mocks.resolveWhatsAppAccount.mockResolvedValue({
      owner: "jefe_1",
      mode: "coexistence",
      phoneNumberId: "jefe-phone-id",
      accessToken: "jefe-token",
      source: "db",
    });

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });

    await POST(req as never);

    expect(mocks.resolveWhatsAppAccount).toHaveBeenCalledWith("jefe-phone-id");
    expect(mocks.enviarMensajeTextoWa).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: "jefe-phone-id",
        accessToken: "jefe-token",
      }),
    );
  });

  it("responde y guarda mensaje cuando el entrante no es texto", async () => {
    mocks.extraerTextosEntrantes.mockReturnValue([]);
    mocks.getConversation.mockResolvedValue({
      state: "esperando_datos",
      name: null,
      nss: null,
      lead_id: "lead-img",
    });
    mocks.ensureLeadProvisional.mockResolvedValue("lead-img");
    mocks.buscarLeadPorTelefono.mockResolvedValue({
      id: "lead-img",
      whatsapp_phone: "5215550000000",
      estado: "nuevo",
    });

    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "phone-id" },
                messages: [
                  {
                    from: "5215550000000",
                    id: "wamid.image.1",
                    type: "image",
                    image: { id: "media-1" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(mocks.procesarYEvolucionar).not.toHaveBeenCalled();
    expect(mocks.enviarMensajeTextoWa).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "5215550000000",
        body:
          "Solo puedo procesar mensajes de texto por el momento. " +
          "Por favor escribe tu respuesta 😊",
      }),
    );
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-img",
      direccion: "saliente",
      contenido:
        "Solo puedo procesar mensajes de texto por el momento. " +
        "Por favor escribe tu respuesta 😊",
    });
  });

  it("con multi-número activo ignora payload de ecos y responde 200", async () => {
    process.env.WHATSAPP_MULTI_NUMBER_ENABLED = "true";
    mocks.payloadDebeIgnorarPorEcos.mockReturnValue(true);
    mocks.extraerTextosEntrantes.mockReturnValue([]);

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({ entry: [{ changes: [{ field: "messages" }] }] }),
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(mocks.ensureLeadProvisional).not.toHaveBeenCalled();
    expect(mocks.procesarYEvolucionar).not.toHaveBeenCalled();
  });
});
