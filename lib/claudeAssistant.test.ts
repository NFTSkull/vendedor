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
  interpretarMensajeTramite,
  interpretarRespuestaCompraCasa,
  interpretarRespuestaGenerador,
  interpretarRespuestaUsuario,
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

describe("interpretarMensajeTramite", () => {
  const contexto = {
    etapa: "captura" as const,
    preguntaActual: "¿Cuál es tu correo electrónico?",
    campoActual: "correo" as const,
    campos: [{ clave: "correo" as const, descripcion: "correo electrónico del cliente" }],
    camposCapturados: [],
    montoNetoEstimado: 152100,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("solo acepta claves de campos del trámite (nunca NSS ni campos internos)", async () => {
    mocks.create.mockResolvedValueOnce(
      respuestaTexto(
        JSON.stringify({
          intencion: "dato",
          datos: {
            correo: " juan@example.com ",
            nss: "12345678901",
            porcentaje_cobro: "10",
            telefono_casa: 8183334444,
          },
          respuesta: null,
        }),
      ),
    );

    const r = await interpretarMensajeTramite({ textoUsuario: "juan@example.com", contexto });

    expect(r).toEqual({ intencion: "dato", datos: { correo: "juan@example.com" }, respuesta: null });
    const prompt = mocks.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("$152,100");
    expect(prompt).toContain("¿Cuál es tu correo electrónico?");
  });

  it("el prompt del trámite incluye la base de ConCasa sin el porcentaje de honorarios", async () => {
    mocks.create.mockResolvedValueOnce(respuestaTexto('{"intencion":"duda","datos":{},"respuesta":null}'));
    await interpretarMensajeTramite({ textoUsuario: "¿dónde están?", contexto });

    const system = mocks.create.mock.calls[0][0].system as string;
    expect(system).toContain("BASE DE CONOCIMIENTO CONCASA");
    expect(system).toContain("Mariano Escobedo 574");
    expect(system).toContain("https://maps.app.goo.gl/dwKfVX3hWdjEEyM46");
    expect(system).toContain("Los trámites ante Infonavit son gratuitos.");
    expect(system).not.toMatch(/18\s?%/);
  });

  it("descarta respuestas de Claude con datos no confirmados (horarios, teléfonos, aprobación)", async () => {
    for (const inventada of [
      "Atendemos de lunes a viernes de 9 a 18 hrs.",
      "Llámanos al 81 1234 5678.",
      "Tu crédito ya está aprobado.",
      "Cobramos 18% de honorarios.",
    ]) {
      mocks.create.mockResolvedValueOnce(
        respuestaTexto(JSON.stringify({ intencion: "duda", datos: {}, respuesta: inventada })),
      );
      const r = await interpretarMensajeTramite({ textoUsuario: "x", contexto });
      expect(r).toEqual({ intencion: "duda", datos: {}, respuesta: null });
    }
  });

  it("intención desconocida o JSON inválido → null (el flujo sigue sin Claude)", async () => {
    mocks.create.mockResolvedValueOnce(respuestaTexto('{"intencion":"agendar"}'));
    expect(await interpretarMensajeTramite({ textoUsuario: "x", contexto })).toBeNull();
    mocks.create.mockResolvedValueOnce(respuestaTexto("no es json"));
    expect(await interpretarMensajeTramite({ textoUsuario: "x", contexto })).toBeNull();
  });
});

describe("la base de ConCasa solo llega a Mejoravit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    mocks.create.mockResolvedValue(respuestaTexto('{"tipo":"fuera_tema","respuestaRetomo":"ok"}'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("Compra de Casa y Generadores no reciben la base ni los honorarios", async () => {
    const phone = "5215550000200";
    await interpretarRespuestaCompraCasa({ phone, casaStep: "municipio", preguntaActual: "¿Municipio?", textoUsuario: "x" });
    await interpretarRespuestaGenerador({ phone, genStep: "tipo", preguntaActual: "¿Tipo?", textoUsuario: "x" });
    limpiarHistorialClaude(phone);

    expect(mocks.create).toHaveBeenCalledTimes(2);
    for (const [llamada] of mocks.create.mock.calls) {
      const todo = `${llamada.system}\n${JSON.stringify(llamada.messages)}`;
      expect(todo).not.toMatch(/ConCasa|Mariano Escobedo|maps\.app\.goo\.gl|honorarios/);
    }
  });

  it("la precalificación de Mejoravit recibe la misma base, sin el porcentaje de honorarios", async () => {
    const phone = "5215550000201";
    await interpretarRespuestaUsuario({
      phone,
      state: "esperando_labor_vigente",
      textoUsuario: "x",
      preguntaActual: "¿Trabajas?",
      tipoEsperado: "si_no",
    });
    limpiarHistorialClaude(phone);

    const system = mocks.create.mock.calls[0][0].system as string;
    expect(system).toContain("BASE DE CONOCIMIENTO CONCASA");
    expect(system).toContain("Mariano Escobedo 574");
    expect(system).toContain("https://maps.app.goo.gl/dwKfVX3hWdjEEyM46");
    expect(system).not.toMatch(/18\s?%/);
  });
});
