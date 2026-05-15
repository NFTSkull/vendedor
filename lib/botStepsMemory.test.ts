import { afterEach, describe, expect, it, vi } from "vitest";

import { procesarYEvolucionar } from "@/lib/botSteps";
import { conversationMemory } from "@/lib/conversationMemory";

describe("botSteps memoria Map", () => {
  afterEach(() => conversationMemory.clear());

  it("flujo hasta confirmación sí y logea lead", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const p = "5211111111111";
    expect(procesarYEvolucionar({ phone: p, textoUsuario: "Hola" })).toContain(
      "nombre completo",
    );
    expect(
      procesarYEvolucionar({ phone: p, textoUsuario: "María García" }),
    ).toContain("NSS");
    expect(
      procesarYEvolucionar({
        phone: p,
        textoUsuario: "12-345-678-901",
      }),
    ).toContain("/ NSS: 12345678901");

    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    expect(logSpy).toHaveBeenCalledWith("[lead confirmado]", {
      phone: p,
      name: "María García",
      nss: "12345678901",
    });

    logSpy.mockRestore();
  });

  it("confirmación No reinicia embudo", () => {
    const p = "5222222222222";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Pedro León" });
    procesarYEvolucionar({ phone: p, textoUsuario: "09876543210" });

    expect(
      procesarYEvolucionar({ phone: p, textoUsuario: "nop" }),
    ).toContain("nombre completo");
  });
});
