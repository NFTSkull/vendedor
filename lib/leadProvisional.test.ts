import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMPRA_CASA_PHONE_NUMBER_ID } from "@/lib/detectarProducto";

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  setConversation: vi.fn(),
  buscarLeadPorTelefono: vi.fn(),
  from: vi.fn(),
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

import { ensureLeadProvisional } from "@/lib/leadProvisional";

describe("ensureLeadProvisional — routing producto con lead existente", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: null,
    });
    mocks.buscarLeadPorTelefono.mockResolvedValue({
      id: "lead-mejoravit-viejo",
      whatsapp_phone: "5215550000000",
      estado: "nuevo",
      advisor_id: null,
    });
  });

  it("lead Mejoravit previo + número reutilizado → conversations.producto=compra_casa, sin tocar leads", async () => {
    const leadId = await ensureLeadProvisional("5215550000000", {
      phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
      primerMensaje: "hola",
    });

    expect(leadId).toBe("lead-mejoravit-viejo");
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000000", {
      state: "inicio",
      lead_id: "lead-mejoravit-viejo",
      producto: "compra_casa",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("con productoForzado y sin lead_id: liga el lead existente sin sobrescribir el producto", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: null,
      producto: "mejoravit",
      data: { productoForzado: "mejoravit" },
    });

    const leadId = await ensureLeadProvisional("5215550000000", {
      phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
      primerMensaje: "hola",
    });

    expect(leadId).toBe("lead-mejoravit-viejo");
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000000", {
      state: "inicio",
      lead_id: "lead-mejoravit-viejo",
      producto: "mejoravit",
    });
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
      phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
      primerMensaje: "sí",
    });

    expect(leadId).toBe("lead-ligado");
    expect(mocks.buscarLeadPorTelefono).not.toHaveBeenCalled();
    expect(mocks.setConversation).not.toHaveBeenCalled();
  });
});

describe("ensureLeadProvisional — lead nuevo con productoForzado", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.buscarLeadPorTelefono.mockResolvedValue(null);
  });

  it("crea el lead con el producto del número pero la conversación conserva el producto forzado", async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: "lead-nuevo" }, error: null }),
      }),
    }));
    mocks.from.mockReturnValue({ insert });
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: null,
      producto: "mejoravit",
      data: { productoForzado: "mejoravit" },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    const leadId = await ensureLeadProvisional("5215550000009", {
      phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
      primerMensaje: "hola",
    });

    expect(leadId).toBe("lead-nuevo");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ producto: "compra_casa" }),
    );
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000009", {
      state: "inicio",
      lead_id: "lead-nuevo",
      producto: "mejoravit",
    });
  });

  it("sin productoForzado, un lead nuevo sigue tomando el producto del número", async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: "lead-normal" }, error: null }),
      }),
    }));
    mocks.from.mockReturnValue({ insert });
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: null,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await ensureLeadProvisional("5215550000010", {
      phoneNumberId: COMPRA_CASA_PHONE_NUMBER_ID,
      primerMensaje: "hola",
    });

    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000010", {
      state: "inicio",
      lead_id: "lead-normal",
      producto: "compra_casa",
    });
  });
});
