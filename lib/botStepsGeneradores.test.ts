import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  setConversation: vi.fn(),
  actualizarLeadPorConversacion: vi.fn(),
}));

vi.mock("@/lib/conversationMemory", () => ({
  getConversation: mocks.getConversation,
  setConversation: mocks.setConversation,
}));

vi.mock("@/lib/leadProvisional", () => ({
  actualizarLeadPorConversacion: mocks.actualizarLeadPorConversacion,
}));

import { procesarYEvolucionarGeneradores } from "@/lib/botStepsGeneradores";

describe("procesarYEvolucionarGeneradores", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actualizarLeadPorConversacion.mockResolvedValue(true);
  });

  it("mensaje vacío → null", async () => {
    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "   ",
    });
    expect(r).toBeNull();
  });

  it("primer mensaje sin genStep → pregunta tipo", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "Hola",
    });

    expect(r).toBe("¿El generador es para uso industrial o residencial?");
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        data: expect.objectContaining({ genStep: "tipo" }),
      }),
    );
  });

  it("flujo completo hasta cierre guarda horario y nota en lead", async () => {
    mocks.getConversation
      .mockResolvedValueOnce({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "horario", gen_tipo: "industrial", gen_equipos: "aires" },
      })
      .mockResolvedValueOnce({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "horario", gen_tipo: "industrial", gen_equipos: "aires" },
      });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "Martes 10am",
    });

    expect(r).toContain("¡Listo!");
    expect(mocks.actualizarLeadPorConversacion).toHaveBeenCalledWith("5215550000000", {
      estado: "nuevo",
      horario: "Martes 10am",
      nota: "Generador — Uso: industrial. Equipos a respaldar: aires.",
    });
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({ state: "finalizado" }),
    );
  });

  it("conversación finalizada → mensaje de cierre", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "finalizado",
      name: null,
      nss: null,
      lead_id: "lead-1",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "Otra pregunta",
    });

    expect(r).toContain("¡Listo!");
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();
  });
});
