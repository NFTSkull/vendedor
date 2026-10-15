import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const interpretarMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/claudeAssistant", () => ({
  claudeDisponible: () => true,
  interpretarRespuestaUsuario: interpretarMock,
  interpretarMensajeTramite: vi.fn(),
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
import { MSG_CONSULTA_NO_DISPONIBLE, MSG_INFONAVIT, MSG_SOLICITUD_DATOS } from "@/lib/botStepsCore";
import { MSG_SIN_INFORMACION_CONFIRMADA } from "@/lib/conocimientoConCasa";
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

describe("botSteps preguntas sobre ConCasa durante la precalificación", () => {
  const PHONE = "5213333333333";
  const COMPLEJA =
    "Oye, antes de seguir: en Infonavit me dijeron que puedo hacerlo por mi cuenta, entonces para qué me sirven ustedes y cómo me acompañan";

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    store.set(PHONE, {
      state: "esperando_infonavit",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "mejoravit",
    });
  });

  it("una pregunta breve se responde localmente, sin Claude ni cambio de estado", async () => {
    const reply = await procesarYEvolucionar({ phone: PHONE, textoUsuario: "¿Dónde están ubicados?" });

    expect(interpretarMock).not.toHaveBeenCalled();
    expect(reply).toContain("Mariano Escobedo 574");
    expect(reply!.endsWith(MSG_INFONAVIT)).toBe(true);
    expect(store.get(PHONE)?.state).toBe("esperando_infonavit");
  });

  it("una pregunta compleja usa la respuesta de Claude validada y siempre retoma la pregunta pendiente", async () => {
    interpretarMock.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo:
        "Puedes hacerlo directamente con Infonavit; ConCasa te acompaña con el expediente, la revisión de documentos y el seguimiento.",
    });

    const reply = await procesarYEvolucionar({ phone: PHONE, textoUsuario: COMPLEJA });

    expect(interpretarMock).toHaveBeenCalledTimes(1);
    expect(reply).toContain("ConCasa te acompaña");
    expect(reply!.endsWith(MSG_INFONAVIT)).toBe(true);
    expect(store.get(PHONE)?.state).toBe("esperando_infonavit");
  });

  it("descarta la respuesta de Claude con datos inventados y usa la base verificada", async () => {
    interpretarMock.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo: "Atendemos de lunes a viernes de 9 a 6, llámanos al 81 1234 5678.",
    });

    const reply = await procesarYEvolucionar({ phone: PHONE, textoUsuario: COMPLEJA });

    expect(reply).not.toMatch(/lunes a viernes|1234/);
    expect(reply).toContain("Puedes realizar tu trámite directamente con Infonavit");
    expect(reply!.endsWith(MSG_INFONAVIT)).toBe(true);
    expect(store.get(PHONE)?.state).toBe("esperando_infonavit");
  });

  it("sin dato verificado lo dice sin inventar y retoma la pregunta", async () => {
    interpretarMock.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo: "Tenemos estacionamiento gratis de lunes a sábado.",
    });

    const reply = await procesarYEvolucionar({
      phone: PHONE,
      textoUsuario: "Oigan y cuando vaya a verlos, tienen estacionamiento para clientes o dónde me paro con el carro",
    });

    expect(reply).toBe(`${MSG_SIN_INFORMACION_CONFIRMADA}\n\n${MSG_INFONAVIT}`);
    expect(store.get(PHONE)?.state).toBe("esperando_infonavit");
  });
});
