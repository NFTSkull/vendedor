import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConversation: vi.fn(),
  setConversation: vi.fn(),
  actualizarLeadPorConversacion: vi.fn(),
  claudeDisponible: vi.fn(),
  interpretarRespuestaCompraCasa: vi.fn(),
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
  interpretarRespuestaCompraCasa: mocks.interpretarRespuestaCompraCasa,
}));

import { procesarYEvolucionarCompraCasa } from "@/lib/botStepsCompraCasa";

const PREGUNTA_MUNICIPIO = "¿En qué municipio se encuentra?";
const PREGUNTA_COLONIA = "¿En qué colonia se encuentra?";
const PREGUNTA_RECAMARAS = "¿Cuántas recámaras tiene?";
const PREGUNTA_BANOS = "¿Cuántos baños tiene?";
const PREGUNTA_TIPO = "¿Es casa o departamento?";
const PREGUNTA_NIVEL_DEPTO = "¿En qué nivel se encuentra?";
const PREGUNTA_PISOS_CASA = "¿De cuántos pisos es la casa?";
const PREGUNTA_INDIVIDUAL_DUPLEX = "¿Es individual o dúplex?";
const PREGUNTA_PAGADA = "¿La propiedad está pagada?";
const PREGUNTA_ACREEDOR = "¿A quién le debe?";
const PREGUNTA_MONTO = "¿Cuánto debe?";
const PREGUNTA_IMAGEN =
  "¿Tienes alguna imagen de la propiedad? Puedes mandarla ahora o más adelante.";
const MSG_CIERRE =
  "¡Listo! Un asesor se comunicará contigo para hacerte una oferta 😊";

type Conv = {
  state: string;
  name: null;
  nss: null;
  lead_id: string;
  producto?: string;
  data?: Record<string, unknown>;
};

function setupConvMutable(initial: Conv) {
  let conv: Conv = { ...initial, data: { ...(initial.data ?? {}) } };
  mocks.getConversation.mockImplementation(async () => ({
    ...conv,
    data: { ...(conv.data ?? {}) },
  }));
  mocks.setConversation.mockImplementation(
    async (_phone: string, next: Partial<Conv>) => {
      conv = {
        ...conv,
        ...next,
        data: { ...(conv.data ?? {}), ...(next.data ?? {}) },
      };
    },
  );
  return () => conv;
}

describe("procesarYEvolucionarCompraCasa", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.actualizarLeadPorConversacion.mockResolvedValue(true);
    mocks.claudeDisponible.mockReturnValue(true);
    mocks.interpretarRespuestaCompraCasa.mockImplementation(
      async (args: { textoUsuario: string }) => ({
        tipo: "valida",
        valorNormalizado: args.textoUsuario,
      }),
    );
  });

  it("flujo feliz: casa individual pagada → cierre y nota completa", async () => {
    const getConv = setupConvMutable({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
    });

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "Hola",
      }),
    ).toBe(PREGUNTA_MUNICIPIO);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "Monterrey",
      }),
    ).toBe(PREGUNTA_COLONIA);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "Cumbres",
      }),
    ).toBe(PREGUNTA_RECAMARAS);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "3",
      }),
    ).toBe(PREGUNTA_BANOS);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "2",
      }),
    ).toBe(PREGUNTA_TIPO);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "casa",
      }),
    ).toBe(PREGUNTA_PISOS_CASA);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "2",
      }),
    ).toBe(PREGUNTA_INDIVIDUAL_DUPLEX);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "individual",
      }),
    ).toBe(PREGUNTA_PAGADA);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "sí",
      }),
    ).toBe(PREGUNTA_IMAGEN);

    const cierre = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "luego la mando",
    });

    expect(cierre).toBe(MSG_CIERRE);
    expect(mocks.actualizarLeadPorConversacion).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        estado: "nuevo",
        nota: expect.stringContaining("Municipio: Monterrey"),
      }),
    );
    const nota = mocks.actualizarLeadPorConversacion.mock.calls[0][1]
      .nota as string;
    expect(nota).toContain("Colonia: Cumbres");
    expect(nota).toContain("Recámaras: 3");
    expect(nota).toContain("Baños: 2");
    expect(nota).toContain("Tipo: casa");
    expect(nota).toContain("2 pisos");
    expect(nota).toContain("individual");
    expect(nota).toContain("Pagada: si");
    expect(getConv().state).toBe("finalizado");
  });

  it("departamento → pregunta nivel y NO pregunta pisos ni individual/dúplex", async () => {
    setupConvMutable({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
      data: {
        casaStep: "tipo_propiedad",
        municipio: "Apodaca",
        colonia: "Centro",
        recamaras: "2",
        banos: "1",
      },
    });

    const r = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "departamento",
    });

    expect(r).toBe(PREGUNTA_NIVEL_DEPTO);
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        data: expect.objectContaining({
          tipoPropiedad: "departamento",
          casaStep: "nivel_depto",
        }),
      }),
    );
    const dataArgs = mocks.setConversation.mock.calls.map(
      (c: unknown[]) => (c[1] as { data?: Record<string, unknown> }).data,
    );
    expect(dataArgs.some((d) => d?.casaStep === "pisos_casa")).toBe(false);
    expect(dataArgs.some((d) => d?.casaStep === "individual_duplex")).toBe(
      false,
    );
  });

  it("propiedad no pagada → pregunta acreedor y monto", async () => {
    const getConv = setupConvMutable({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
      data: {
        casaStep: "pagada",
        municipio: "Monterrey",
        colonia: "Obispado",
        recamaras: "3",
        banos: "2",
        tipoPropiedad: "casa",
        pisosCasa: "2",
        tipoCasa: "individual",
      },
    });

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "no",
      }),
    ).toBe(PREGUNTA_ACREEDOR);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "Infonavit",
      }),
    ).toBe(PREGUNTA_MONTO);

    expect(
      await procesarYEvolucionarCompraCasa({
        phone: "5215550000000",
        textoUsuario: "180000",
      }),
    ).toBe(PREGUNTA_IMAGEN);

    const cierre = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "ahorita no",
    });
    expect(cierre).toBe(MSG_CIERRE);
    const nota = mocks.actualizarLeadPorConversacion.mock.calls[0][1]
      .nota as string;
    expect(nota).toContain("Pagada: no");
    expect(nota).toContain("Debe a: Infonavit");
    expect(nota).toContain("Monto: 180000");
    expect(getConv().state).toBe("finalizado");
  });

  it("fuera de tema retoma la misma pregunta", async () => {
    setupConvMutable({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
      data: { casaStep: "colonia", municipio: "Monterrey" },
    });

    mocks.interpretarRespuestaCompraCasa.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo: `Te sirve para preparar una oferta justa. ${PREGUNTA_COLONIA}`,
    });

    const r = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "¿por qué necesitan mi colonia?",
    });

    expect(r).toBe(
      `Te sirve para preparar una oferta justa. ${PREGUNTA_COLONIA}`,
    );
    expect(mocks.interpretarRespuestaCompraCasa).toHaveBeenCalled();
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();
  });

  it("colonia: 'no sé' fuera_tema → no avanza a recamaras", async () => {
    const getConv = setupConvMutable({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
      data: { casaStep: "colonia", municipio: "Monterrey" },
    });

    mocks.interpretarRespuestaCompraCasa.mockResolvedValue({
      tipo: "fuera_tema",
      respuestaRetomo: `Sin problema, si la recuerdas después nos sirve. ${PREGUNTA_COLONIA}`,
    });

    const r = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "no sé",
    });

    expect(r).toContain(PREGUNTA_COLONIA);
    expect(getConv().data?.casaStep).toBe("colonia");
    expect(getConv().data?.colonia).toBeUndefined();
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();
  });

  it("imagen: pregunta no cierra hasta respuesta válida", async () => {
    setupConvMutable({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
      data: {
        casaStep: "imagen",
        municipio: "Monterrey",
        colonia: "Cumbres",
        recamaras: "3",
        banos: "2",
        tipoPropiedad: "casa",
        pisosCasa: "2",
        tipoCasa: "individual",
        pagada: "si",
      },
    });

    mocks.interpretarRespuestaCompraCasa.mockResolvedValueOnce({
      tipo: "fuera_tema",
      respuestaRetomo: `No es obligatorio, puedes mandarla después. ${PREGUNTA_IMAGEN}`,
    });

    const r1 = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "¿es obligatorio mandarla?",
    });

    expect(mocks.interpretarRespuestaCompraCasa).toHaveBeenCalled();
    expect(r1).toContain(PREGUNTA_IMAGEN);
    expect(mocks.actualizarLeadPorConversacion).not.toHaveBeenCalled();

    mocks.interpretarRespuestaCompraCasa.mockResolvedValueOnce({
      tipo: "valida",
      valorNormalizado: "luego la mando",
    });

    const r2 = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "luego la mando",
    });

    expect(r2).toBe(MSG_CIERRE);
    expect(mocks.actualizarLeadPorConversacion).toHaveBeenCalled();
  });

  it("reinicio a medio flujo vuelve a municipio", async () => {
    setupConvMutable({
      state: "inicio",
      name: null,
      nss: null,
      lead_id: "lead-1",
      producto: "compra_casa",
      data: {
        casaStep: "recamaras",
        municipio: "Monterrey",
        colonia: "Cumbres",
      },
    });

    const r = await procesarYEvolucionarCompraCasa({
      phone: "5215550000000",
      textoUsuario: "reiniciar",
    });

    expect(r).toBe(PREGUNTA_MUNICIPIO);
    expect(mocks.setConversation).toHaveBeenCalledWith(
      "5215550000000",
      expect.objectContaining({
        data: expect.objectContaining({ casaStep: "municipio" }),
      }),
    );
  });
});
