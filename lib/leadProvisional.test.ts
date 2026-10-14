import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADVISOR_ID_BERNARDO,
  ADVISOR_ID_GUILLERMO,
  ENERGRUM_PHONE_NUMBER_ID,
  NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
} from "@/lib/detectarProducto";

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  setConversation: vi.fn(),
  buscarLeadPorTelefono: vi.fn(),
  from: vi.fn(),
  sincronizarProductoLead: vi.fn(),
  registrarAccionAutomatica: vi.fn(),
}));

vi.mock("@/lib/conversationMemory", () => ({
  getConversation: mocks.getConversation,
  setConversation: mocks.setConversation,
}));

vi.mock("@/lib/messagesDb", () => ({
  buscarLeadPorTelefono: mocks.buscarLeadPorTelefono,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: mocks.from,
  }),
}));

vi.mock("@/lib/productoLead", () => ({
  ACCION_ASESOR_AUTOMATICO: "asesor_asignado_automatico",
  sincronizarProductoLead: mocks.sincronizarProductoLead,
  registrarAccionAutomatica: mocks.registrarAccionAutomatica,
}));

import { ensureLeadProvisional } from "@/lib/leadProvisional";

const CONV_NUEVA = { state: "inicio", name: null, nss: null, lead_id: null };

function mockInsertLead(id: string) {
  const insert = vi.fn<(payload: Record<string, unknown>) => unknown>(() => ({
    select: () => ({
      single: async () => ({ data: { id }, error: null }),
    }),
  }));
  mocks.from.mockReturnValue({ insert });
  return insert;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ensureLeadProvisional — lead existente en el número compartido", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getConversation.mockResolvedValue(CONV_NUEVA);
    mocks.buscarLeadPorTelefono.mockResolvedValue({
      id: "lead-viejo",
      whatsapp_phone: "5215550000000",
      estado: "nuevo",
      advisor_id: null,
    });
  });

  it("mensaje ambiguo → conversación sin_clasificar y el lead no se toca (lo fija el menú)", async () => {
    const leadId = await ensureLeadProvisional("5215550000000", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "hola",
    });

    expect(leadId).toBe("lead-viejo");
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000000", {
      state: "inicio",
      lead_id: "lead-viejo",
      producto: "sin_clasificar",
    });
    expect(mocks.sincronizarProductoLead).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("mensaje clasificado → conversación y leads.producto quedan con el mismo producto", async () => {
    await ensureLeadProvisional("5215550000000", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "quiero vender mi casa",
    });

    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000000", {
      state: "inicio",
      lead_id: "lead-viejo",
      producto: "compra_casa",
    });
    expect(mocks.sincronizarProductoLead).toHaveBeenCalledWith(
      "lead-viejo",
      "compra_casa",
      "primer_mensaje",
    );
  });

  it("con productoForzado y sin lead_id: liga el lead y sincroniza el producto forzado", async () => {
    mocks.getConversation.mockResolvedValue({
      ...CONV_NUEVA,
      producto: "mejoravit",
      data: { productoForzado: "mejoravit" },
    });

    const leadId = await ensureLeadProvisional("5215550000000", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "quiero vender mi casa",
    });

    expect(leadId).toBe("lead-viejo");
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000000", {
      state: "inicio",
      lead_id: "lead-viejo",
      producto: "mejoravit",
    });
    expect(mocks.sincronizarProductoLead).toHaveBeenCalledWith("lead-viejo", "mejoravit", "comando");
  });

  it("con lead_id ya ligado no vuelve a evaluar el producto", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "esperando_infonavit",
      name: null,
      nss: null,
      lead_id: "lead-ligado",
      producto: "mejoravit",
      data: { productoForzado: "mejoravit" },
    });

    const leadId = await ensureLeadProvisional("5215550000000", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "sí",
    });

    expect(leadId).toBe("lead-ligado");
    expect(mocks.buscarLeadPorTelefono).not.toHaveBeenCalled();
    expect(mocks.setConversation).not.toHaveBeenCalled();
    expect(mocks.sincronizarProductoLead).not.toHaveBeenCalled();
  });
});

describe("ensureLeadProvisional — lead nuevo: producto y asesor automático", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buscarLeadPorTelefono.mockResolvedValue(null);
    mocks.getConversation.mockResolvedValue(CONV_NUEVA);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("Mejoravit sin variable configurada → se asigna a Guillermo y queda en lead_actions", async () => {
    vi.stubEnv("DEFAULT_ADVISOR_MEJORAVIT", "");
    const insert = mockInsertLead("lead-mv");

    await ensureLeadProvisional("5215550000001", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "Me interesa el Mejoravit",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ producto: "mejoravit", advisor_id: ADVISOR_ID_GUILLERMO }),
    );
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000001", {
      state: "inicio",
      lead_id: "lead-mv",
      producto: "mejoravit",
    });
    expect(mocks.registrarAccionAutomatica).toHaveBeenCalledWith(
      "lead-mv",
      "asesor_asignado_automatico",
      `mejoravit: ${ADVISOR_ID_GUILLERMO}`,
    );
  });

  it("Compra de Casa usa DEFAULT_ADVISOR_COMPRA_CASA cuando está configurada", async () => {
    vi.stubEnv("DEFAULT_ADVISOR_COMPRA_CASA", "asesor-casas-uuid");
    const insert = mockInsertLead("lead-cc");

    await ensureLeadProvisional("5215550000002", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "quiero vender mi casa",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ producto: "compra_casa", advisor_id: "asesor-casas-uuid" }),
    );
  });

  it("el anuncio de Meta clasifica el lead nuevo aunque el mensaje sea genérico", async () => {
    const insert = mockInsertLead("lead-anuncio");

    await ensureLeadProvisional("5215550000003", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "Hola, más información",
      referral: { headline: "Vende tu casa en 30 días", body: null, sourceUrl: null },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ producto: "compra_casa", advisor_id: ADVISOR_ID_GUILLERMO }),
    );
  });

  it("el prefijo G-/B- tiene prioridad sobre el asesor por defecto", async () => {
    const insert = mockInsertLead("lead-prefijo");

    await ensureLeadProvisional("5215550000004", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "Me interesa el Mejoravit",
      advisorId: ADVISOR_ID_BERNARDO,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ producto: "mejoravit", advisor_id: ADVISOR_ID_BERNARDO }),
    );
    expect(mocks.registrarAccionAutomatica).not.toHaveBeenCalled();
  });

  it("sin_clasificar → sin asesor hasta que elija en el menú", async () => {
    const insert = mockInsertLead("lead-sc");

    await ensureLeadProvisional("5215550000005", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "hola",
    });

    const payload = insert.mock.calls[0][0];
    expect(payload).toMatchObject({ producto: "sin_clasificar" });
    expect(payload).not.toHaveProperty("advisor_id");
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000005", {
      state: "inicio",
      lead_id: "lead-sc",
      producto: "sin_clasificar",
    });
    expect(mocks.registrarAccionAutomatica).not.toHaveBeenCalled();
  });

  it("Generadores no se asigna automáticamente", async () => {
    const insert = mockInsertLead("lead-gen");

    await ensureLeadProvisional("5215550000006", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "¡Hola! Quiero más información de generadores para mi casa.",
    });

    const payload = insert.mock.calls[0][0];
    expect(payload).toMatchObject({ producto: "generadores" });
    expect(payload).not.toHaveProperty("advisor_id");
    expect(mocks.registrarAccionAutomatica).not.toHaveBeenCalled();
  });

  it("Paneles no se asigna automáticamente", async () => {
    const insert = mockInsertLead("lead-pan");

    await ensureLeadProvisional("5215550000007", {
      phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
      primerMensaje: "paneles solares",
    });

    const payload = insert.mock.calls[0][0];
    expect(payload).toMatchObject({ producto: "paneles" });
    expect(payload).not.toHaveProperty("advisor_id");
    expect(mocks.registrarAccionAutomatica).not.toHaveBeenCalled();
  });

  it("con productoForzado, el lead nuevo se crea con el producto forzado (igual que la conversación)", async () => {
    mocks.getConversation.mockResolvedValue({
      ...CONV_NUEVA,
      producto: "mejoravit",
      data: { productoForzado: "mejoravit" },
    });
    const insert = mockInsertLead("lead-forzado");

    await ensureLeadProvisional("5215550000009", {
      phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
      primerMensaje: "quiero vender mi casa",
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ producto: "mejoravit" }));
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000009", {
      state: "inicio",
      lead_id: "lead-forzado",
      producto: "mejoravit",
    });
  });
});
