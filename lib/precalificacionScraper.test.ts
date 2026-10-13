import { describe, expect, it } from "vitest";

import {
  extraerDatosPortal,
  normalizarEmpresa,
  normalizarRegistroPatronal,
} from "@/lib/precalificacionScraper";

const BASE = {
  califica: true,
  nss: "12345678901",
  nombre: "APELLIDO APELLIDO NOMBRE",
  rfc: "XAXX010101000",
  advertenciaInscripcion: null,
  datos: { saldoSubcuenta: "100,000.00" },
};

describe("extraerDatosPortal", () => {
  it("sin datos laborales", () => {
    const d = extraerDatosPortal({ ...BASE, empresa: null, registroPatronal: null });
    expect(d.empresa).toBeNull();
    expect(d.registroPatronal).toBeNull();
  });

  it("con empresa y registro patronal", () => {
    const d = extraerDatosPortal({
      ...BASE,
      empresa: "  ACME CONSTRUCTORA   SA DE CV ",
      registroPatronal: "y38-1535610-4",
    });
    expect(d.empresa).toBe("ACME CONSTRUCTORA SA DE CV");
    expect(d.registroPatronal).toBe("Y3815356104");
  });

  it("solo con empresa", () => {
    const d = extraerDatosPortal({ ...BASE, empresa: "ACME SA", registroPatronal: null });
    expect(d).toMatchObject({ empresa: "ACME SA", registroPatronal: null });
  });

  it("solo con registro patronal", () => {
    const d = extraerDatosPortal({ ...BASE, empresa: null, registroPatronal: "Y3815356104" });
    expect(d).toMatchObject({ empresa: null, registroPatronal: "Y3815356104" });
  });

  it("claves ausentes o respuesta no objeto no truenan", () => {
    expect(extraerDatosPortal({ califica: true })).toEqual({
      nombre: null,
      rfc: null,
      rfcConHomoclave: false,
      empresa: null,
      registroPatronal: null,
    });
    expect(extraerDatosPortal(null).empresa).toBeNull();
  });

  it("RFC sin homoclave según el portal no se considera confiable", () => {
    expect(extraerDatosPortal(BASE).rfcConHomoclave).toBe(true);
    expect(
      extraerDatosPortal({ ...BASE, advertenciaInscripcion: "RFC sin homoclave" })
        .rfcConHomoclave,
    ).toBe(false);
    expect(extraerDatosPortal({ ...BASE, rfc: "XAXX010101" }).rfcConHomoclave).toBe(false);
  });
});

describe("validación de valores del portal", () => {
  it("descarta etiquetas y valores basura en empresa", () => {
    for (const v of ["N.R.P.", "R.F.C.:", "123", "", "  ", 5, null]) {
      expect(normalizarEmpresa(v)).toBeNull();
    }
  });

  it("registro patronal requiere 11 caracteres alfanuméricos con dígitos", () => {
    expect(normalizarRegistroPatronal("Y3815356104")).toBe("Y3815356104");
    for (const v of ["Y381535610", "Y38153561045", "ABCDEFGHIJK", "N.R.P.", null]) {
      expect(normalizarRegistroPatronal(v)).toBeNull();
    }
  });
});
