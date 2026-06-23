import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  setConversation: vi.fn(),
  actualizarLeadPorConversacion: vi.fn(),
  claudeDisponible: vi.fn(),
  interpretarRespuestaGenerador: vi.fn(),
  interpretarHorarioConClaude: vi.fn(),
}));

vi.mock("@/lib/conversationMemory", () => ({
  getConversation: mocks.getConversation,
  setConversation: mocks.setConversation,
}));

vi.mock("@/lib/leadProvisional", () => ({
  actualizarLeadPorConversacion: mocks.actualizarLeadPorConversacion,
}));

vi.mock("@/lib/claudeAssistant", () => ({
  claudeDisponible: mocks.claudeDisponible,
  interpretarRespuestaGenerador: mocks.interpretarRespuestaGenerador,
}));

vi.mock("@/lib/interpretarHorarioContacto", () => ({
  interpretarHorarioConClaude: mocks.interpretarHorarioConClaude,
}));

import { procesarYEvolucionarGeneradores } from "@/lib/botStepsGeneradores";

const PREGUNTA_TIPO = "¿El generador es para uso industrial o residencial?";
const PREGUNTA_EQUIPOS = "¿Qué equipos necesitas respaldar?";
const PREGUNTA_HORARIO = "¿En qué día y horario te podemos contactar?";

describe("procesarYEvolucionarGeneradores", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actualizarLeadPorConversacion.mockResolvedValue(true);
    mocks.claudeDisponible.mockReturnValue(true);
    mocks.interpretarHorarioConClaude.mockResolvedValue({
      fecha_contacto: "2026-06-23T10:00:00-06:00",
      confianza: "media",
      razon: "test",
    });
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
    expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
  });

  it("respuesta válida normalizada avanza y guarda valorNormalizado", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: { genStep: "tipo" },
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "es para mi fábrica",
    });

    expect(r).toBe(PREGUNTA_EQUIPOS);
    expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        data: expect.objectContaining({
          gen_tipo: "industrial",
          genStep: "equipos",
        }),
      }),
    );
  });

  it("fuera_tema no avanza de paso", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: { genStep: "equipos", gen_tipo: "industrial" },
    });
    mocks.interpretarRespuestaGenerador.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo: "Te cotizamos en la llamada. ¿Qué equipos necesitas respaldar?",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "¿cuánto cuesta?",
    });

    expect(r).toBe("Te cotizamos en la llamada. ¿Qué equipos necesitas respaldar?");
    expect(mocks.setConversation).not.toHaveBeenCalled();
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();
  });

  it("agradece a medio flujo no avanza", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: { genStep: "tipo" },
    });
    mocks.interpretarRespuestaGenerador.mockResolvedValue({
      tipo: "agradece",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "gracias",
    });

    expect(r).toBe(
      "¡Con gusto! Solo para terminar: ¿El generador es para uso industrial o residencial?",
    );
    expect(mocks.setConversation).not.toHaveBeenCalled();
  });

  it("agradece en paso horario retoma pregunta y no cierra", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: {
        genStep: "horario",
        gen_tipo: "industrial",
        gen_equipos: "aires",
      },
    });
    mocks.interpretarRespuestaGenerador.mockResolvedValue({
      tipo: "agradece",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "muchas gracias",
    });

    expect(r).toBe(`¡Con gusto! Solo para terminar: ${PREGUNTA_HORARIO}`);
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();
    expect(mocks.setConversation).not.toHaveBeenCalled();
  });

  it("horario válido cierra y guarda horario normalizado en lead", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: { genStep: "horario", gen_tipo: "industrial", gen_equipos: "aires" },
    });
    mocks.interpretarRespuestaGenerador.mockResolvedValue({
      tipo: "valida",
      valorNormalizado: "Martes 10am",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "el martes como a las 10",
    });

    expect(r).toContain("¡Listo!");
    expect(mocks.actualizarLeadPorConversacion).toHaveBeenCalledWith("5215550000000", {
      estado: "nuevo",
      horario: "Martes 10am",
      nota: "Generador — Uso: industrial. Equipos a respaldar: aires.",
    });
    expect(mocks.interpretarHorarioConClaude).toHaveBeenCalledWith("Martes 10am");
    expect(mocks.setConversation).toHaveBeenCalledTimes(1);
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        state: "finalizado",
        data: expect.objectContaining({
          gen_horario: "Martes 10am",
          genStep: "horario",
        }),
      }),
    );
  });

  it("conversación finalizada → mensaje post-cierre sin re-guardar", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "finalizado",
      name: null,
      nss: null,
      lead_id: "lead-1",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "gracias",
    });

    expect(r).toBe("Gracias a usted, en un momento le contactamos. ⚡");
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();
    expect(mocks.setConversation).not.toHaveBeenCalled();
  });

  it("reiniciar a media pregunta → PREGUNTA_TIPO preservando gen_tipo", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "generadores",
      data: { genStep: "equipos", gen_tipo: "industrial" },
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "reiniciar",
    });

    expect(r).toBe("¿El generador es para uso industrial o residencial?");
    expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        data: expect.objectContaining({
          genStep: "tipo",
          gen_tipo: "industrial",
        }),
      }),
    );
  });

  it('"no" como respuesta → repite pregunta, no avanza ni llama Claude', async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: { genStep: "tipo" },
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "no",
    });

    expect(r).toBe(
      "Entendido. ¿El generador es para uso industrial o residencial?",
    );
    expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
    expect(mocks.setConversation).not.toHaveBeenCalled();
  });

  it('"👍" o "..." → repite pregunta, no avanza ni llama Claude', async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: { genStep: "equipos", gen_tipo: "residencial" },
    });

    for (const texto of ["👍", "..."]) {
      vi.resetAllMocks();
      mocks.actualizarLeadPorConversacion.mockResolvedValue(true);
      mocks.claudeDisponible.mockReturnValue(true);
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "equipos", gen_tipo: "residencial" },
      });

      const r = await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: texto,
      });

      expect(r).toBe("¿Qué equipos necesitas respaldar?");
      expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
      expect(mocks.setConversation).not.toHaveBeenCalled();
    }
  });

  describe("detección determinística tipo (antes de Claude)", () => {
    it('"Residencial, me puedes cotizar por favor" avanza sin Claude', async () => {
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "tipo" },
      });

      const r = await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: "Residencial, me puedes cotizar por favor",
      });

      expect(r).toBe(PREGUNTA_EQUIPOS);
      expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
      expect(mocks.setConversation).toHaveBeenCalledWith(
        "5215550000000",
        expect.objectContaining({
          data: expect.objectContaining({
            gen_tipo: "residencial",
            genStep: "equipos",
          }),
        }),
      );
    });

    it('"Industrial" solo avanza', async () => {
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "tipo" },
      });

      const r = await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: "Industrial",
      });

      expect(r).toBe(PREGUNTA_EQUIPOS);
      expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
      expect(mocks.setConversation).toHaveBeenCalledWith(
        "5215550000000",
        expect.objectContaining({
          data: expect.objectContaining({ gen_tipo: "industrial" }),
        }),
      );
    });

    it('"Para mi casa" infiere residencial', async () => {
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "tipo" },
      });

      const r = await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: "Para mi casa",
      });

      expect(r).toBe(PREGUNTA_EQUIPOS);
      expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
      expect(mocks.setConversation).toHaveBeenCalledWith(
        "5215550000000",
        expect.objectContaining({
          data: expect.objectContaining({ gen_tipo: "residencial" }),
        }),
      );
    });

    it('"Para mi fábrica" infiere industrial', async () => {
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "tipo" },
      });

      const r = await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: "Para mi fábrica",
      });

      expect(r).toBe(PREGUNTA_EQUIPOS);
      expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
      expect(mocks.setConversation).toHaveBeenCalledWith(
        "5215550000000",
        expect.objectContaining({
          data: expect.objectContaining({ gen_tipo: "industrial" }),
        }),
      );
    });

    it('"Cuánto cuesta?" en tipo → fuera_tema sin avanzar', async () => {
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "tipo" },
      });
      mocks.interpretarRespuestaGenerador.mockResolvedValue({
        tipo: "fuera_tema",
        respuestaRetomo: PREGUNTA_TIPO,
      });

      const r = await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: "Cuánto cuesta?",
      });

      expect(r).toBe(PREGUNTA_TIPO);
      expect(mocks.interpretarRespuestaGenerador).toHaveBeenCalledOnce();
      expect(mocks.setConversation).not.toHaveBeenCalled();
    });

    it("residencial e industrial en el mismo mensaje delega a Claude", async () => {
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "tipo" },
      });
      mocks.interpretarRespuestaGenerador.mockResolvedValue({
        tipo: "valida",
        valorNormalizado: "mixto",
      });

      await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: "Es residencial e industrial",
      });

      expect(mocks.interpretarRespuestaGenerador).toHaveBeenCalledOnce();
    });
  });

  describe("detección determinística equipos", () => {
    it('"Refrigerador y 2 minisplit" avanza a horario sin Claude', async () => {
      mocks.getConversation.mockResolvedValue({
        state: "inicio",
        name: null,
        nss: null,
        lead_id: "lead-1",
        data: { genStep: "equipos", gen_tipo: "residencial" },
      });

      const r = await procesarYEvolucionarGeneradores({
        phone: "5215550000000",
        textoUsuario: "Refrigerador y 2 minisplit",
      });

      expect(r).toBe(PREGUNTA_HORARIO);
      expect(mocks.interpretarRespuestaGenerador).not.toHaveBeenCalled();
      expect(mocks.setConversation).toHaveBeenCalledWith(
        "5215550000000",
        expect.objectContaining({
          data: expect.objectContaining({
            gen_equipos: "Refrigerador y 2 minisplit",
            genStep: "horario",
          }),
        }),
      );
    });
  });

  it("fuera_tema con valorNormalizado avanza y concatena siguiente pregunta", async () => {
    mocks.getConversation.mockResolvedValue({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      data: { genStep: "tipo" },
    });
    mocks.interpretarRespuestaGenerador.mockResolvedValue({
      tipo: "fuera_tema",
      valorNormalizado: "residencial",
      respuestaRetomo: "Te cotizamos en la llamada.",
    });

    const r = await procesarYEvolucionarGeneradores({
      phone: "5215550000000",
      textoUsuario: "algo ambiguo sin keyword",
    });

    expect(r).toBe(`Te cotizamos en la llamada. ${PREGUNTA_EQUIPOS}`);
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        data: expect.objectContaining({
          gen_tipo: "residencial",
          genStep: "equipos",
        }),
      }),
    );
  });
});
