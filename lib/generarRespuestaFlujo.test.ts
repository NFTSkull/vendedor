import { describe, expect, it } from "vitest";

import * as flujoRaw from "../generarRespuesta.js";

type Respuesta = { respuesta: string; nuevoEstado: string };
type GenerarRespuesta = (mensaje: string, estado: string) => Respuesta;

const { generarRespuesta } = flujoRaw as unknown as {
  generarRespuesta: GenerarRespuesta;
};

describe("flujo de preguntas de precalificacion", () => {
  it("recorre el camino feliz hasta pedir horario de contacto", () => {
    const paso1 = generarRespuesta("hola", "inicio");
    expect(paso1.nuevoEstado).toBe("relacion_laboral");

    const paso2 = generarRespuesta("si", paso1.nuevoEstado);
    expect(paso2.nuevoEstado).toBe("alta_infonavit");

    const paso3 = generarRespuesta("si", paso2.nuevoEstado);
    expect(paso3.nuevoEstado).toBe("credito_activo");

    const paso4 = generarRespuesta("no", paso3.nuevoEstado);
    expect(paso4.nuevoEstado).toBe("centro_trabajo_nl");

    const paso5 = generarRespuesta("si", paso4.nuevoEstado);
    expect(paso5.nuevoEstado).toBe("nss");

    const paso6 = generarRespuesta("12345678901", paso5.nuevoEstado);
    expect(paso6.nuevoEstado).toBe("contacto");
    expect(paso6.respuesta.toLowerCase()).toContain("monto autorizado");
    expect(paso6.respuesta.toLowerCase()).toContain("día y horario");
  });

  it("cierra cuando no hay relacion laboral vigente en nuevo leon", () => {
    const inicio = generarRespuesta("hola", "inicio");
    const corte = generarRespuesta("no", inicio.nuevoEstado);

    expect(corte.nuevoEstado).toBe("fin");
    expect(corte.respuesta.toLowerCase()).toContain("requisito indispensable");
  });

  it("cierra cuando ya tiene credito infonavit activo", () => {
    const p1 = generarRespuesta("hola", "inicio");
    const p2 = generarRespuesta("si", p1.nuevoEstado);
    const p3 = generarRespuesta("si", p2.nuevoEstado);
    const corte = generarRespuesta("si", p3.nuevoEstado);

    expect(corte.nuevoEstado).toBe("fin");
    expect(corte.respuesta.toLowerCase()).toContain("termines de pagar");
  });
});
