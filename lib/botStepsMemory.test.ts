import { afterEach, describe, expect, it, vi } from "vitest";

import { procesarYEvolucionar } from "@/lib/botSteps";
import { conversationMemory } from "@/lib/conversationMemory";

const FLUJO_SI = [
  "Hola",
  "si",
  "SI",
  "no",
  "si",
  "María García 12345678901",
  "ok",
  "sí",
  "Martes 10am",
] as const;

describe("botSteps memoria Map", () => {
  afterEach(() => conversationMemory.clear());

  it("flujo completo hasta cierre con asesor y logea lead", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const p = "5211111111111";
    let reply: string | null = null;

    for (const paso of FLUJO_SI) {
      reply = procesarYEvolucionar({ phone: p, textoUsuario: paso });
      expect(reply).toBeTruthy();
    }

    expect(reply).toContain("8114118767");
    expect(reply).toContain("8140100246");

    expect(logSpy).toHaveBeenCalledWith("[lead confirmado]", {
      phone: p,
      name: "María García",
      nss: "12345678901",
    });
    expect(logSpy).toHaveBeenCalledWith("[lead horario]", {
      phone: p,
      name: "María García",
      nss: "12345678901",
      horario: "Martes 10am",
    });

    logSpy.mockRestore();
  });

  it("muestra monto con línea en blanco, sin cantidad fija", () => {
    const p = "5233333333333";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    let reply = procesarYEvolucionar({
      phone: p,
      textoUsuario: "Pedro León 09876543210",
    });
    expect(reply).toContain("__________");

    reply = procesarYEvolucionar({ phone: p, textoUsuario: "listo" });
    expect(reply).not.toMatch(/\$169,?000/);
    expect(reply).not.toMatch(/MXN/);
  });

  it("rechaza sin relación laboral vigente", () => {
    const p = "5244444444444";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    const reply = procesarYEvolucionar({ phone: p, textoUsuario: "no" });

    expect(reply).toContain("relación laboral vigente en Nuevo León");
    expect(reply).not.toContain(
      "Para revisar si puedes continuar con tu trámite",
    );
  });

  it("rechaza crédito Infonavit activo", () => {
    const p = "5255555555555";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    const reply = procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    expect(reply).toContain("termines de pagar tu crédito Infonavit");
  });

  it("interés No cierra conversación amablemente", () => {
    const p = "5266666666666";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "si" });
    procesarYEvolucionar({ phone: p, textoUsuario: "si" });
    procesarYEvolucionar({ phone: p, textoUsuario: "no" });
    procesarYEvolucionar({ phone: p, textoUsuario: "si" });
    procesarYEvolucionar({
      phone: p,
      textoUsuario: "Ana López 11111111111",
    });
    procesarYEvolucionar({ phone: p, textoUsuario: "vale" });
    const reply = procesarYEvolucionar({ phone: p, textoUsuario: "NO" });

    expect(reply).toContain("Entendido, gracias por contactarnos");
  });
});
