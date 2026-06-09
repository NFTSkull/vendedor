import { beforeEach, describe, expect, it, vi } from "vitest";

const interpretarMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/claudeAssistant", () => ({
  claudeDisponible: () => true,
  interpretarRespuestaUsuario: interpretarMock,
  limpiarHistorialClaude: vi.fn(),
  limpiarMarkdown: (t: string) => t,
  naturalizarMensajeBot: vi.fn(),
}));

vi.mock("@/lib/conversationMemory", () => {
  const store = new Map<
    string,
    { state: string; name: null; nss: null; lead_id: string | null; producto?: string }
  >();
  return {
    getConversation: vi.fn(async (phone: string) => {
      return (
        store.get(phone) ?? {
          state: "inicio",
          name: null,
          nss: null,
          lead_id: null,
          producto: "mejoravit",
        }
      );
    }),
    setConversation: vi.fn(async (phone: string, patch: { state: string }) => {
      const prev = store.get(phone) ?? {
        state: "inicio",
        name: null,
        nss: null,
        lead_id: null,
        producto: "mejoravit",
      };
      store.set(phone, { ...prev, ...patch });
    }),
    deleteConversation: vi.fn(async (phone: string) => {
      store.delete(phone);
    }),
    __store: store,
  };
});

vi.mock("@/lib/leadProvisional", () => ({
  ensureLeadProvisional: vi.fn(async () => "lead-1"),
  actualizarLeadPorConversacion: vi.fn(async () => true),
}));

vi.mock("@/lib/messagesDb", () => ({
  buscarLeadPorTelefono: vi.fn(async () => null),
}));

import { procesarYEvolucionar } from "@/lib/botSteps";
import * as conversationMemory from "@/lib/conversationMemory";

const store = (
  conversationMemory as unknown as {
    __store: Map<
      string,
      { state: string; name: null; nss: null; lead_id: string | null; producto?: string }
    >;
  }
).__store;

describe("botSteps opt-out antes de Claude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    store.set("5211111111111", {
      state: "esperando_infonavit",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "mejoravit",
    });
    interpretarMock.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo: "Eso no responde la pregunta. ¿Estás dado de alta en Infonavit?",
    });
  });

  it("aplica opt-out sin depender de la interpretación de Claude", async () => {
    const reply = await procesarYEvolucionar({
      phone: "5211111111111",
      textoUsuario: "no me interesa",
    });

    expect(interpretarMock).not.toHaveBeenCalled();
    expect(reply).toContain("no te molestaremos más");
    expect(store.get("5211111111111")?.state).toBe("finalizado");
  });
});
