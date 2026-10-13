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
  enviarPushNuevoMensaje: vi.fn(),
  procesarYEvolucionar: vi.fn(),
  enviarMensajeTextoWa: vi.fn(),
  maybeSingleIntervencion: vi.fn(),
  updateLeadsEstado: vi.fn(),
  aplicarComandoProducto: vi.fn(),
  firmaMetaValida: vi.fn(),
}));

vi.mock("@/lib/metaWebhookSignature", () => ({
  firmaMetaValida: mocks.firmaMetaValida,
}));

vi.mock("@/lib/comandoProducto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/comandoProducto")>()),
  aplicarComandoProducto: mocks.aplicarComandoProducto,
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
  enviarPushNuevoMensaje: mocks.enviarPushNuevoMensaje,
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

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "lead_actions") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                limit: () => ({
                  maybeSingle: mocks.maybeSingleIntervencion,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: () => mocks.updateLeadsEstado(payload),
          }),
        };
      }
      return {};
    },
  }),
}));

import { POST } from "@/app/api/webhook/route";
import {
  ADVISOR_ID_ADMIN,
  COMPRA_CASA_PHONE_NUMBER_ID,
} from "@/lib/detectarProducto";

const MSG_CONFIRMACION_MEJORAVIT =
  "Listo, a partir de ahora estamos para ayudarte con tu crédito Mejoravit.";

function postWebhook() {
  return POST(
    new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    }) as never,
  );
}

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
    mocks.enviarPushNuevoMensaje.mockResolvedValue(undefined);
    mocks.buscarLeadPorTelefono.mockResolvedValue(null);
    mocks.buscarLeadPorId.mockResolvedValue({
      id: "lead-1",
      whatsapp_phone: "5215550000000",
      estado: "nuevo",
    });
    mocks.procesarYEvolucionar.mockResolvedValue("Respuesta del bot");
    mocks.enviarMensajeTextoWa.mockResolvedValue({ ok: true, status: 200, data: {} });
    mocks.guardarMensaje.mockResolvedValue(true);
    mocks.maybeSingleIntervencion.mockResolvedValue({ data: null });
    mocks.updateLeadsEstado.mockResolvedValue({ error: null });
    mocks.firmaMetaValida.mockReturnValue(true);
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
      advisorId: null,
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-1",
      direccion: "entrante",
      contenido: "Hola",
      origen: "cliente",
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-1",
      direccion: "saliente",
      contenido: "Respuesta del bot",
      origen: "bot",
    });
    expect(mocks.enviarPushNuevoLead).toHaveBeenCalledWith({
      leadId: "lead-1",
      telefono: "5215550000000",
      horario: null,
      advisorId: ADVISOR_ID_ADMIN,
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
      origen: "cliente",
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-recien-creado",
      direccion: "saliente",
      contenido: "Respuesta del bot",
      origen: "bot",
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
      origen: "bot",
    });
    expect(mocks.guardarMensaje).toHaveBeenCalledWith({
      leadId: "lead-3",
      direccion: "saliente",
      contenido: "Respuesta del bot",
      origen: "bot",
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

  it("envía push de nuevo mensaje cuando el lead ya existía", async () => {
    mocks.buscarLeadPorTelefono.mockResolvedValue({
      id: "lead-existente",
      whatsapp_phone: "5215550000000",
      estado: "contactado",
    });
    mocks.getConversation.mockResolvedValue({
      state: "finalizado",
      name: null,
      nss: null,
      lead_id: "lead-existente",
    });
    mocks.buscarLeadPorId.mockResolvedValue({
      id: "lead-existente",
      whatsapp_phone: "5215550000000",
      estado: "contactado",
    });

    const req = new Request("http://localhost/api/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    });

    await POST(req as never);

    expect(mocks.enviarPushNuevoLead).not.toHaveBeenCalled();
    expect(mocks.enviarPushNuevoMensaje).toHaveBeenCalledWith({
      leadId: "lead-existente",
      telefono: "5215550000000",
      mensaje: "Hola",
      advisorId: null,
    });
    expect(mocks.procesarYEvolucionar).toHaveBeenCalledWith({
      phone: "5215550000000",
      textoUsuario: "Hola",
    });
    expect(mocks.updateLeadsEstado).toHaveBeenCalledWith({ estado: "nuevo" });
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
      origen: "bot",
    });
  });

  it("rechaza con 401 si la firma de Meta no es válida y no procesa nada", async () => {
    mocks.firmaMetaValida.mockReturnValue(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.META_APP_SECRET = "secreto-test";

    const res = await POST(
      new Request("http://localhost/api/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=firma-falsa" },
        body: JSON.stringify({ entry: [] }),
      }) as never,
    );

    expect(res.status).toBe(401);
    expect(mocks.firmaMetaValida).toHaveBeenCalledWith(
      Buffer.from(JSON.stringify({ entry: [] })),
      "sha256=firma-falsa",
      "secreto-test",
    );
    expect(mocks.ensureLeadProvisional).not.toHaveBeenCalled();
    expect(mocks.procesarYEvolucionar).not.toHaveBeenCalled();
    expect(mocks.enviarMensajeTextoWa).not.toHaveBeenCalled();
    delete process.env.META_APP_SECRET;
    errorSpy.mockRestore();
  });

  describe("comando de producto en el número 8114118767", () => {
    beforeEach(() => {
      mocks.aplicarComandoProducto.mockResolvedValue(MSG_CONFIRMACION_MEJORAVIT);
      vi.stubEnv("COMANDO_PRODUCTO_TEST_PHONES", "5215550000000");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("cambia el producto, responde la confirmación y no pasa por el bot", async () => {
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5215550000000",
          body: "Activa Mejoravit",
          wamid: "wamid.cmd.1",
          phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
        },
      ]);

      const res = await postWebhook();

      expect(res.status).toBe(200);
      expect(mocks.aplicarComandoProducto).toHaveBeenCalledWith(
        "5215550000000",
        "mejoravit",
      );
      expect(mocks.procesarYEvolucionar).not.toHaveBeenCalled();
      expect(mocks.enviarMensajeTextoWa).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "5215550000000",
          body: MSG_CONFIRMACION_MEJORAVIT,
        }),
      );
      expect(mocks.guardarMensaje).toHaveBeenCalledWith({
        leadId: "lead-1",
        direccion: "saliente",
        contenido: MSG_CONFIRMACION_MEJORAVIT,
        origen: "bot",
      });
    });

    it("'activa compra de casa' del teléfono autorizado cambia a casas", async () => {
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5215550000000",
          body: "activa compra de casa",
          wamid: "wamid.cmd.2",
          phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
        },
      ]);

      await postWebhook();

      expect(mocks.aplicarComandoProducto).toHaveBeenCalledWith(
        "5215550000000",
        "compra_casa",
      );
      expect(mocks.procesarYEvolucionar).not.toHaveBeenCalled();
    });

    it("un cliente no autorizado que escribe el comando sigue al bot normal", async () => {
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5218100000000",
          body: "activa mejoravit",
          wamid: "wamid.cmd.6",
          phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
        },
      ]);

      await postWebhook();

      expect(mocks.aplicarComandoProducto).not.toHaveBeenCalled();
      expect(mocks.procesarYEvolucionar).toHaveBeenCalledWith({
        phone: "5218100000000",
        textoUsuario: "activa mejoravit",
      });
    });

    it("sin COMANDO_PRODUCTO_TEST_PHONES nadie puede usar el comando", async () => {
      vi.stubEnv("COMANDO_PRODUCTO_TEST_PHONES", "");
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5215550000000",
          body: "activa mejoravit",
          wamid: "wamid.cmd.7",
          phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
        },
      ]);

      await postWebhook();

      expect(mocks.aplicarComandoProducto).not.toHaveBeenCalled();
      expect(mocks.procesarYEvolucionar).toHaveBeenCalled();
    });

    it("usa el phone_number_id de Meta, no el del entorno", async () => {
      process.env.WHATSAPP_PHONE_NUMBER_ID = COMPRA_CASA_PHONE_NUMBER_ID;
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5215550000000",
          body: "activa mejoravit",
          wamid: "wamid.cmd.8",
          phoneNumberId: null,
        },
      ]);

      await postWebhook();

      expect(mocks.aplicarComandoProducto).not.toHaveBeenCalled();
      expect(mocks.procesarYEvolucionar).toHaveBeenCalled();
    });

    it("el mismo texto en otro número sigue al bot normal", async () => {
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5215550000000",
          body: "Activa Mejoravit",
          wamid: "wamid.cmd.3",
          phoneNumberId: "otro-phone-id",
        },
      ]);

      await postWebhook();

      expect(mocks.aplicarComandoProducto).not.toHaveBeenCalled();
      expect(mocks.procesarYEvolucionar).toHaveBeenCalledWith({
        phone: "5215550000000",
        textoUsuario: "Activa Mejoravit",
      });
    });

    it("un mensaje normal en ese número sigue al bot normal", async () => {
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5215550000000",
          body: "Hola, quiero vender mi casa",
          wamid: "wamid.cmd.4",
          phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
        },
      ]);

      await postWebhook();

      expect(mocks.aplicarComandoProducto).not.toHaveBeenCalled();
      expect(mocks.procesarYEvolucionar).toHaveBeenCalledWith({
        phone: "5215550000000",
        textoUsuario: "Hola, quiero vender mi casa",
      });
    });

    it("si un asesor ya intervino, el comando tampoco responde", async () => {
      mocks.extraerTextosEntrantes.mockReturnValue([
        {
          from: "5215550000000",
          body: "activa mejoravit",
          wamid: "wamid.cmd.5",
          phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
        },
      ]);
      mocks.buscarLeadPorTelefono.mockResolvedValue({
        id: "lead-1",
        whatsapp_phone: "5215550000000",
        estado: "contactado",
      });
      mocks.maybeSingleIntervencion.mockResolvedValue({ data: { id: "accion-1" } });

      await postWebhook();

      expect(mocks.aplicarComandoProducto).not.toHaveBeenCalled();
      expect(mocks.procesarYEvolucionar).not.toHaveBeenCalled();
      expect(mocks.enviarMensajeTextoWa).not.toHaveBeenCalled();
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
