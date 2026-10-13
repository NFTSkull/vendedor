import { describe, expect, it } from "vitest";

import {
  estimarCreditoMejoravit,
  TOPE_MONTO_MEJORAVIT,
} from "@/lib/mejoravitCredito";

describe("estimarCreditoMejoravit", () => {
  it("monto menor al tope: aplica solo el 90%", () => {
    expect(estimarCreditoMejoravit(100000)).toEqual({
      montoBase: 100000,
      montoTopado: 100000,
      montoNetoEstimado: 90000,
    });
  });

  it("monto igual al tope: neto máximo de $152,100", () => {
    expect(estimarCreditoMejoravit(TOPE_MONTO_MEJORAVIT)).toEqual({
      montoBase: 169000,
      montoTopado: 169000,
      montoNetoEstimado: 152100,
    });
  });

  it("monto superior al tope: se topa en 169,000 y conserva el base original", () => {
    expect(estimarCreditoMejoravit(250000)).toEqual({
      montoBase: 250000,
      montoTopado: 169000,
      montoNetoEstimado: 152100,
    });
  });

  it("el 90% redondea hacia abajo", () => {
    expect(estimarCreditoMejoravit(168999).montoNetoEstimado).toBe(152099);
    expect(estimarCreditoMejoravit(12345.67).montoNetoEstimado).toBe(11111);
  });

  it("nunca supera el neto máximo", () => {
    for (const base of [169001, 500000, 1e9]) {
      expect(estimarCreditoMejoravit(base).montoNetoEstimado).toBe(152100);
    }
  });

  it("montos inválidos dan cero", () => {
    expect(estimarCreditoMejoravit(Number.NaN).montoNetoEstimado).toBe(0);
    expect(estimarCreditoMejoravit(-5).montoNetoEstimado).toBe(0);
  });
});
