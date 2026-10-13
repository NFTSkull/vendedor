import { describe, expect, it } from "vitest";

import { evaluarVigenciaIne } from "@/lib/ineVigencia";

const HOY = new Date("2026-10-13T12:00:00-06:00");

describe("evaluarVigenciaIne", () => {
  it("toma el último año del bloque, no el de emisión", () => {
    expect(evaluarVigenciaIne("2019 - 2029", HOY)).toEqual({
      estado: "vigente",
      anioVencimiento: 2029,
    });
    expect(evaluarVigenciaIne("2014-2024", HOY)).toEqual({
      estado: "vencida",
      anioVencimiento: 2024,
    });
  });

  it("vale hasta el 31 de diciembre del año de vencimiento", () => {
    expect(evaluarVigenciaIne("2016 - 2026", HOY).estado).toBe("vigente");
    expect(
      evaluarVigenciaIne("2016 - 2026", new Date("2027-01-01T12:00:00-06:00")).estado,
    ).toBe("vencida");
  });

  it("acepta el formato con la palabra VIGENCIA y un solo año", () => {
    expect(evaluarVigenciaIne("VIGENCIA 2030", HOY)).toEqual({
      estado: "vigente",
      anioVencimiento: 2030,
    });
  });

  it("sin dato o con formato no reconocido queda indeterminada, nunca aprobada", () => {
    for (const texto of [null, undefined, "", "29", "vence pronto", "2029 - 2019", "1890 - 1900"]) {
      expect(evaluarVigenciaIne(texto, HOY)).toEqual({
        estado: "indeterminada",
        anioVencimiento: null,
      });
    }
  });
});
