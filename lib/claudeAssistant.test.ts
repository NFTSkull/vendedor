import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mocks.create };
  },
}));

import {
  interpretarRespuestaCompraCasa,
  limpiarHistorialClaude,
  naturalizarMensajeBot,
} from "@/lib/claudeAssistant";

function respuestaTexto(text: string) {
  return { content: [{ type: "text", text }] };
}

async function sembrarHistorialCompraCasa(phone: string): Promise<void> {
  mocks.create.mockResolvedValueOnce(
    respuestaTexto(
      JSON.stringify({
        tipo: "fuera_tema",
        respuestaRetomo: "Un asesor te da la oferta. ¿En qué municipio se encuentra?",
      }),
    ),
  );
  await interpretarRespuestaCompraCasa({
    phone,
    casaStep: "municipio",
    preguntaActual: "¿En qué municipio se encuentra?",
    textoUsuario: "¿cuánto me darían por mi casa?",
  });
}

function mensajesDeLlamada(n: number): Array<{ role: string; content: string }> {
  return mocks.create.mock.calls[n][0].messages;
}

describe("limpiarHistorialClaude", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("el historial del flujo anterior llega a Claude si no se limpia", async () => {
    const phone = "5215550000100";
    await sembrarHistorialCompraCasa(phone);
    mocks.create.mockResolvedValueOnce(respuestaTexto("Hola de nuevo"));

    await naturalizarMensajeBot({ phone, mensajeBase: "Hola" });

    const mensajes = mensajesDeLlamada(1);
    expect(mensajes).toHaveLength(3);
    expect(mensajes[0]).toEqual({
      role: "user",
      content: "¿cuánto me darían por mi casa?",
    });
    limpiarHistorialClaude(phone);
  });

  it("después de limpiar, la siguiente llamada a Claude no lleva mensajes previos", async () => {
    const phone = "5215550000101";
    await sembrarHistorialCompraCasa(phone);
    limpiarHistorialClaude(phone);
    mocks.create.mockResolvedValueOnce(respuestaTexto("Buenas tardes"));

    await naturalizarMensajeBot({ phone, mensajeBase: "Buenas tardes" });

    const mensajes = mensajesDeLlamada(1);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0].role).toBe("user");
    expect(mensajes[0].content).toContain("Buenas tardes");
    expect(JSON.stringify(mensajes)).not.toContain("municipio");
  });

  it("solo limpia la conversación indicada", async () => {
    const limpia = "5215550000102";
    const otra = "5215550000103";
    await sembrarHistorialCompraCasa(limpia);
    await sembrarHistorialCompraCasa(otra);
    limpiarHistorialClaude(limpia);
    mocks.create.mockResolvedValueOnce(respuestaTexto("ok"));

    await naturalizarMensajeBot({ phone: otra, mensajeBase: "Hola" });

    expect(mensajesDeLlamada(2)).toHaveLength(3);
    limpiarHistorialClaude(otra);
  });
});
