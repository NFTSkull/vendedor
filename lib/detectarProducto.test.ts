import { describe, expect, it } from "vitest";

import {
  detectarProducto,
  ENERGRUM_PHONE_NUMBER_ID,
  MEJORAVIT_PHONE_NUMBER_ID,
} from "@/lib/detectarProducto";

describe("detectarProducto", () => {
  it("número Mejoravit → siempre mejoravit sin importar mensaje", () => {
    expect(
      detectarProducto({
        phoneNumberId: MEJORAVIT_PHONE_NUMBER_ID,
        primerMensaje: "quiero paneles solares y generadores",
      }),
    ).toBe("mejoravit");
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
