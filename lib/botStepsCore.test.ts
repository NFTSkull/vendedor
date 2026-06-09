import { describe, expect, it } from "vitest";

import { esOptOut, mensajeFinalizadoPost } from "@/lib/botStepsCore";

describe("botStepsCore opt-out y cierre", () => {
  it("detecta frases de desinterés normalizadas", () => {
    expect(esOptOut("No me interesa")).toBe(true);
    expect(esOptOut("adiós")).toBe(true);
    expect(esOptOut("Hasta luego")).toBe(true);
    expect(esOptOut("no")).toBe(false);
  });

  it("arma mensaje final con o sin horario", () => {
    expect(mensajeFinalizadoPost("martes 10am")).toContain(
      "un asesor te contactará martes 10am",
    );
    expect(mensajeFinalizadoPost("")).toContain("te contactará pronto");
    expect(mensajeFinalizadoPost("martes 10am")).toContain("8140100246");
  });
});
