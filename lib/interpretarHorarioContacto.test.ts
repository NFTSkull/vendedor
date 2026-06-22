import { beforeEach, describe, expect, it, vi } from "vitest";

const REFERENCIA_MX = new Date("2026-06-22T22:00:00.000Z"); // 16:00 en México UTC-6

const mocks = vi.hoisted(() => ({
  claudeDisponible: vi.fn(),
  messagesCreate: vi.fn(),
}));

vi.mock("@/lib/claudeAssistant", () => ({
  claudeDisponible: mocks.claudeDisponible,
  clienteAnthropic: () => ({
    messages: { create: mocks.messagesCreate },
  }),
  MODELO: "claude-haiku-test",
}));

import { interpretarHorarioConClaude } from "./interpretarHorarioContacto";

function respuestaClaude(json: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: JSON.stringify(json) }],
  };
}

describe("interpretarHorarioConClaude", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claudeDisponible.mockReturnValue(true);
  });

  it("hoy 6:30pm → alta + ISO de hoy 18:30", async () => {
    mocks.messagesCreate.mockResolvedValue(
      respuestaClaude({
        fecha_contacto: "2026-06-22T18:30:00-06:00",
        confianza: "alta",
        razon: "Día y hora explícitos",
      }),
    );

    const r = await interpretarHorarioConClaude("hoy 6:30pm", REFERENCIA_MX);

    expect(r).toEqual({
      fecha_contacto: "2026-06-22T18:30:00-06:00",
      confianza: "alta",
      razon: "Día y hora explícitos",
    });
  });

  it("mañana por la mañana → media + ISO de mañana 10:00", async () => {
    mocks.messagesCreate.mockResolvedValue(
      respuestaClaude({
        fecha_contacto: "2026-06-23T10:00:00-06:00",
        confianza: "media",
        razon: "Mañana con hora estimada",
      }),
    );

    const r = await interpretarHorarioConClaude(
      "mañana por la mañana",
      REFERENCIA_MX,
    );

    expect(r).toEqual({
      fecha_contacto: "2026-06-23T10:00:00-06:00",
      confianza: "media",
      razon: "Mañana con hora estimada",
    });
  });

  it("todas las tardes a partir de las 6 → baja + null", async () => {
    mocks.messagesCreate.mockResolvedValue(
      respuestaClaude({
        fecha_contacto: "2026-06-22T18:00:00-06:00",
        confianza: "baja",
        razon: "Horario recurrente sin día concreto",
      }),
    );

    const r = await interpretarHorarioConClaude(
      "todas las tardes a partir de las 6",
      REFERENCIA_MX,
    );

    expect(r).toEqual({
      fecha_contacto: null,
      confianza: "baja",
      razon: "Horario recurrente sin día concreto",
    });
  });

  it("cuando puedan → baja + null", async () => {
    mocks.messagesCreate.mockResolvedValue(
      respuestaClaude({
        fecha_contacto: null,
        confianza: "baja",
        razon: "Sin día ni hora",
      }),
    );

    const r = await interpretarHorarioConClaude("cuando puedan", REFERENCIA_MX);

    expect(r?.fecha_contacto).toBeNull();
    expect(r?.confianza).toBe("baja");
  });

  it("error de API → baja + null sin lanzar excepción", async () => {
    mocks.messagesCreate.mockRejectedValue(new Error("timeout"));

    const r = await interpretarHorarioConClaude("hoy 5pm", REFERENCIA_MX);

    expect(r).toEqual({
      fecha_contacto: null,
      confianza: "baja",
      razon: "Error",
    });
  });

  it("Claude no disponible → null", async () => {
    mocks.claudeDisponible.mockReturnValue(false);

    const r = await interpretarHorarioConClaude("hoy 5pm", REFERENCIA_MX);

    expect(r).toBeNull();
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });
});
