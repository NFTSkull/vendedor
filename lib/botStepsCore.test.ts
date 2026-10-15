import { describe, expect, it } from "vitest";

import {
  esOptOut,
  mensajeFinalizadoPost,
  MSG_CONSULTA_EN_CURSO,
  MSG_CREDITO_ACTIVO,
  MSG_NSS_EN_ESPERA,
  MSG_PREGUNTA_LABOR,
  MSG_SOLICITUD_DATOS,
  retomoDelEstado,
} from "@/lib/botStepsCore";

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

describe("retomoDelEstado", () => {
  it("retoma la pregunta pendiente sin repetir el saludo", () => {
    expect(retomoDelEstado("esperando_labor_vigente")).toBe(MSG_PREGUNTA_LABOR);
    expect(retomoDelEstado("esperando_credito_activo")).toBe(MSG_CREDITO_ACTIVO);
    expect(retomoDelEstado("esperando_datos", {})).toBe(MSG_SOLICITUD_DATOS);
  });

  it("con NSS pendiente no lo vuelve a pedir", () => {
    expect(retomoDelEstado("esperando_datos", { nssPendiente: "12345678901" })).toBe(MSG_NSS_EN_ESPERA);
    expect(
      retomoDelEstado("esperando_datos", {
        nssPendiente: "12345678901",
        consultaIniciadaAt: new Date().toISOString(),
      }),
    ).toBe(MSG_CONSULTA_EN_CURSO);
  });
});
