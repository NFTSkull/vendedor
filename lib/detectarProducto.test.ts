import { describe, expect, it } from "vitest";

import {
  ADVISOR_ID_BERNARDO,
  ADVISOR_ID_GUILLERMO,
  clasificarNumeroCompartido,
  detectarPrefijoAsesor,
  detectarProducto,
  ENERGRUM_PHONE_NUMBER_ID,
  NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
} from "@/lib/detectarProducto";

function compartido(primerMensaje: string, referral?: Parameters<typeof detectarProducto>[0]["referral"]) {
  return detectarProducto({
    phoneNumberId: NUMERO_COMPARTIDO_PHONE_NUMBER_ID,
    primerMensaje,
    referral,
  });
}

describe("detectarProducto — número compartido (1177472778778882)", () => {
  it("el ID del número compartido es el de +52 81 1411 8767", () => {
    expect(NUMERO_COMPARTIDO_PHONE_NUMBER_ID).toBe("1177472778778882");
  });

  describe("a) anuncio de Meta (referral)", () => {
    it("anuncio Mejoravit decide el producto aunque el mensaje sea genérico", () => {
      expect(
        compartido("Hola, quiero más información", {
          headline: "Crédito Mejoravit",
          body: "Usa tu saldo Infonavit para mejorar tu casa",
        }),
      ).toBe("mejoravit");
    });

    it("anuncio de venta de casa → compra_casa", () => {
      expect(
        compartido("Hola", { headline: "¿Quieres vender tu casa?", body: "Te la compramos rápido" }),
      ).toBe("compra_casa");
    });

    it("anuncio de generadores → generadores", () => {
      expect(compartido("Hola", { headline: "Generadores eléctricos", body: null })).toBe(
        "generadores",
      );
    });

    it("el anuncio gana sobre las palabras del mensaje", () => {
      expect(
        compartido("quiero vender mi casa", { headline: "Crédito Mejoravit", body: null }),
      ).toBe("mejoravit");
    });

    it("texto del anuncio en la URL de origen también cuenta", () => {
      expect(
        compartido("Hola", { sourceUrl: "https://www.facebook.com/mejoravit-nl/posts/123" }),
      ).toBe("mejoravit");
    });

    it("anuncio sin texto identificable → cae a las palabras del mensaje", () => {
      expect(
        compartido("quiero vender mi depa", { headline: "¡Escríbenos!", body: "Te atendemos hoy" }),
      ).toBe("compra_casa");
    });

    it("anuncio ambiguo (dos productos) → cae a las palabras del mensaje", () => {
      expect(
        compartido("Hola", {
          headline: "Vende tu casa aunque tengas crédito Infonavit",
          body: null,
        }),
      ).toBe("sin_clasificar");
    });
  });

  describe("b) palabras clave estrictas del primer mensaje", () => {
    it.each([
      ["Me interesa el Mejoravit", "mejoravit"],
      ["Mi NSS es 12345678901", "mejoravit"],
      ["Quiero un crédito Infonavit", "mejoravit"],
      ["info del credito de infonavit", "mejoravit"],
      ["Necesito un préstamo", "mejoravit"],
      ["Quiero vender", "compra_casa"],
      ["Me interesa la venta de mi casa", "compra_casa"],
      ["Quiero vender mi propiedad", "compra_casa"],
      ["vender mi depa en Apodaca", "compra_casa"],
      ["Vendo mi casa", "compra_casa"],
      ["¡Hola! Quiero más información de generadores para mi casa.", "generadores"],
      ["Info del generador", "generadores"],
      ["Vi la vacante", "generadores"],
    ] as const)("%s → %s", (mensaje, esperado) => {
      expect(compartido(mensaje)).toBe(esperado);
    });

    it("mayúsculas, acentos y signos no afectan", () => {
      expect(compartido("¡¡PRÉSTAMO!!")).toBe("mejoravit");
      expect(compartido("¿VENDER?")).toBe("compra_casa");
    });
  });

  describe("c) mensajes ambiguos → sin_clasificar", () => {
    it.each([
      "Hola",
      "Buenas tardes, información por favor",
      "",
      "Vivo en la colonia Infonavit Las Puentes",
      "Infonavit",
      "Me interesa la casa",
      "Quiero comprar una casa",
      "prestamista",
      "Quiero vender mi casa y saber del crédito Infonavit",
    ])("%j → sin_clasificar", (mensaje) => {
      expect(compartido(mensaje)).toBe("sin_clasificar");
    });
  });

  it("clasificarNumeroCompartido sin referral equivale a solo palabras clave", () => {
    expect(clasificarNumeroCompartido({ primerMensaje: "nss" })).toBe("mejoravit");
    expect(clasificarNumeroCompartido({ primerMensaje: "hola", referral: null })).toBe(
      "sin_clasificar",
    );
  });
});

describe("detectarProducto — otros números", () => {
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
