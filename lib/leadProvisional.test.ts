import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONCASA_GENERADORES_PHONE_NUMBER_ID } from "@/lib/detectarProducto";

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

  it("lead Mejoravit previo + número generadores → conversations.producto=generadores, sin tocar leads", async () => {
    const leadId = await ensureLeadProvisional("5215550000000", {
      phoneNumberId: CONCASA_GENERADORES_PHONE_NUMBER_ID,
      primerMensaje: "hola",
    });

    expect(leadId).toBe("lead-mejoravit-viejo");
    expect(mocks.setConversation).toHaveBeenCalledWith("5215550000000", {
      state: "inicio",
      lead_id: "lead-mejoravit-viejo",
      producto: "generadores",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
