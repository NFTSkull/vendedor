import { afterEach, describe, expect, it, vi } from "vitest";

import { procesarYEvolucionar } from "@/lib/botSteps";
import { conversationMemory } from "@/lib/conversationMemory";

const FLUJO_SI = [
  "Hola",
  "si",
  "SI",
  "no",
  "si",
  "12345678901",
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
      name: null,
      nss: "12345678901",
    });
    expect(logSpy).toHaveBeenCalledWith("[lead horario]", {
      phone: p,
      name: null,
      nss: "12345678901",
      horario: "Martes 10am",
    });

    logSpy.mockRestore();
  });

  it("muestra monto con línea en blanco y pregunta horario, sin cantidad fija", () => {
    const p = "5233333333333";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    const reply = procesarYEvolucionar({
      phone: p,
      textoUsuario: "09876543210",
    });

    expect(reply).toContain("aproximadamente de ___");
    expect(reply).toContain("día y horario");
    expect(reply).not.toMatch(/\$169,?000/);
    expect(reply).not.toMatch(/MXN/);
    expect(reply).not.toContain("puede variar");
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

  it("reinicia el flujo con comando reiniciar en cualquier paso", () => {
    const p = "5277777777777";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    const reply = procesarYEvolucionar({ phone: p, textoUsuario: "REINICIAR" });

    expect(reply).toContain("Buenas tardes, gracias por contactarnos");
    expect(reply).toContain("relación laboral vigente en Nuevo León");
    expect(conversationMemory.get(p)?.state).toBe("esperando_labor_vigente");
    expect(conversationMemory.get(p)?.name).toBeNull();
    expect(conversationMemory.get(p)?.nss).toBeNull();
  });

  it.each(["reiniciar", "Reiniciar", "empezar de nuevo", "iniciar de nuevo"])(
    "acepta comando de reinicio: %s",
    (comando) => {
      const p = "5288888888888";
      procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
      procesarYEvolucionar({ phone: p, textoUsuario: comando });

      expect(conversationMemory.get(p)?.state).toBe("esperando_labor_vigente");
    },
  );

  it("acepta solo NSS de 11 dígitos sin nombre", () => {
    const p = "5299999999999";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "No" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    const reply = procesarYEvolucionar({
      phone: p,
      textoUsuario: "01234567890",
    });

    expect(reply).toContain("aproximadamente de ___");
    expect(conversationMemory.get(p)?.nss).toBe("01234567890");
  });

  it("rechaza crédito Infonavit activo", () => {
    const p = "5255555555555";
    procesarYEvolucionar({ phone: p, textoUsuario: "Hola" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });
    const reply = procesarYEvolucionar({ phone: p, textoUsuario: "Sí" });

    expect(reply).toContain("termines de pagar tu crédito Infonavit");
  });
});
