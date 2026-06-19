import { describe, expect, it } from "vitest";

import {
  ADVISOR_ID_BERNARDO,
  ADVISOR_ID_GUILLERMO,
  CONCASA_GENERADORES_PHONE_NUMBER_ID,
  detectarPrefijoAsesor,
  detectarProducto,
  ENERGRUM_PHONE_NUMBER_ID,
  MEJORAVIT_PHONE_NUMBER_ID,
} from "@/lib/detectarProducto";

describe("detectarProducto", () => {
  it("override temporal Mejoravit (1177472778778882) → generadores", () => {
    expect(
      detectarProducto({
        phoneNumberId: MEJORAVIT_PHONE_NUMBER_ID,
        primerMensaje: "quiero paneles solares y generadores",
      }),
    ).toBe("generadores");
  });

  it("mismo ID vía constante override → generadores", () => {
    expect(
      detectarProducto({
        phoneNumberId: CONCASA_GENERADORES_PHONE_NUMBER_ID,
        primerMensaje: "hola",
      }),
    ).toBe("generadores");
  });

  it("Energrum + paneles solares → paneles", () => {
    expect(
      detectarProducto({
        phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
        primerMensaje: "paneles solares",
      }),
    ).toBe("paneles");
  });

  it("Energrum + quiero información sobre paneles → paneles", () => {
    expect(
      detectarProducto({
        phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
        primerMensaje: "quiero información sobre paneles",
      }),
    ).toBe("paneles");
  });

  it("Energrum + generadores industriales → generadores", () => {
    expect(
      detectarProducto({
        phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
        primerMensaje: "generadores industriales",
      }),
    ).toBe("generadores");
  });

  it("Energrum + generador para mi casa → generadores", () => {
    expect(
      detectarProducto({
        phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
        primerMensaje: "generador para mi casa",
      }),
    ).toBe("generadores");
  });

  it("Energrum + hola buenos días → sin_clasificar", () => {
    expect(
      detectarProducto({
        phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
        primerMensaje: "hola buenos días",
      }),
    ).toBe("sin_clasificar");
  });

  it("Energrum + PANELES (mayúsculas) → paneles", () => {
    expect(
      detectarProducto({
        phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
        primerMensaje: "PANELES",
      }),
    ).toBe("paneles");
  });

  it("phoneNumberId desconocido → mejoravit", () => {
    expect(
      detectarProducto({
        phoneNumberId: "999999999999999",
        primerMensaje: "paneles solares",
      }),
    ).toBe("mejoravit");
  });

  it("Energrum + solar sin tilde en mayúsculas → paneles", () => {
    expect(
      detectarProducto({
        phoneNumberId: ENERGRUM_PHONE_NUMBER_ID,
        primerMensaje: "energía SOLAR para mi negocio",
      }),
    ).toBe("paneles");
  });
});

describe("detectarPrefijoAsesor", () => {
  it("G-Hola asigna Guillermo y limpia el texto", () => {
    const r = detectarPrefijoAsesor("G-Hola");
    expect(r.advisorId).toBe(ADVISOR_ID_GUILLERMO);
    expect(r.textoLimpio).toBe("Hola");
  });

  it("b-buenos días asigna Bernardo (case insensitive prefijo)", () => {
    const r = detectarPrefijoAsesor("b-buenos días");
    expect(r.advisorId).toBe(ADVISOR_ID_BERNARDO);
    expect(r.textoLimpio).toBe("buenos días");
  });

  it("sin prefijo no asigna y conserva el texto", () => {
    const r = detectarPrefijoAsesor("Hola buenos días");
    expect(r.advisorId).toBeNull();
    expect(r.textoLimpio).toBe("Hola buenos días");
  });

  it("G- solo asigna asesor y deja texto vacío", () => {
    const r = detectarPrefijoAsesor("G-");
    expect(r.advisorId).toBe(ADVISOR_ID_GUILLERMO);
    expect(r.textoLimpio).toBe("");
  });

  it("copy Meta Ads G- residencial asigna Guillermo y limpia prefijo", () => {
    const r = detectarPrefijoAsesor(
      "G- ¡Hola! Quiero más información de generadores para mi casa.",
    );
    expect(r.advisorId).toBe(ADVISOR_ID_GUILLERMO);
    expect(r.textoLimpio).toBe(
      "¡Hola! Quiero más información de generadores para mi casa.",
    );
  });

  it("copy Meta Ads B- residencial asigna Bernardo", () => {
    const r = detectarPrefijoAsesor(
      "B- ¡Hola! Quiero más información de generadores para mi casa.",
    );
    expect(r.advisorId).toBe(ADVISOR_ID_BERNARDO);
    expect(r.textoLimpio).toBe(
      "¡Hola! Quiero más información de generadores para mi casa.",
    );
  });
});
