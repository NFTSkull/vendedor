import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { MSG_CONSULTA_NO_DISPONIBLE, MSG_SOLICITUD_DATOS } from "@/lib/botStepsCore";
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

describe("botSteps con NSS pendiente de consulta", () => {
  const PHONE = "5212222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    vi.stubEnv("SCRAPER_URL", "https://scraper.test");
    vi.stubEnv("SCRAPER_SECRET", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    interpretarMock.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo: MSG_SOLICITUD_DATOS,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("no pasa por Claude y reintenta la consulta sin pedir el NSS", async () => {
    store.set(PHONE, {
      state: "esperando_datos",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "mejoravit",
      data: { nssPendiente: "12345678901" },
    } as never);

    const reply = await procesarYEvolucionar({ phone: PHONE, textoUsuario: "ok" });

    expect(interpretarMock).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://scraper.test/precalificar",
      expect.objectContaining({ method: "POST" }),
    );
    expect(reply).toBe(MSG_CONSULTA_NO_DISPONIBLE);
  });

  it("sin NSS pendiente sigue usando Claude como antes", async () => {
    store.set(PHONE, {
      state: "esperando_datos",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "mejoravit",
    });

    const reply = await procesarYEvolucionar({ phone: PHONE, textoUsuario: "ok" });

    expect(interpretarMock).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(reply).toBe(MSG_SOLICITUD_DATOS);
  });
});
