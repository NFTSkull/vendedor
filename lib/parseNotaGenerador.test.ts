import { describe, expect, it } from "vitest";

import {
  esGeneradoresLead,
  esMejoravitLead,
  parsearNotaGenerador,
} from "@/lib/parseNotaGenerador";

describe("parsearNotaGenerador", () => {
  it("parsea formato del bot con em dash", () => {
    const r = parsearNotaGenerador(
      "Generador — Uso: industrial. Equipos a respaldar: aires.",
    );
    expect(r).toEqual({
      tipo: "parseado",
      uso: "industrial",
      equipos: "aires",
    });
  });

  it("acepta N/D como valores válidos", () => {
    const r = parsearNotaGenerador(
      "Generador — Uso: N/D. Equipos a respaldar: N/D.",
    );
    expect(r).toMatchObject({ tipo: "parseado", uso: "N/D", equipos: "N/D" });
  });

  it("nota editada → modo cruda", () => {
    const r = parsearNotaGenerador("Cliente interesado en cotización urgente");
    expect(r).toEqual({
      tipo: "cruda",
      nota: "Cliente interesado en cotización urgente",
    });
  });

  it("nota vacía → null", () => {
    expect(parsearNotaGenerador("")).toBeNull();
    expect(parsearNotaGenerador(null)).toBeNull();
  });
});

describe("esMejoravitLead", () => {
  it("null/undefined/mejoravit → true", () => {
    expect(esMejoravitLead(null)).toBe(true);
    expect(esMejoravitLead(undefined)).toBe(true);
    expect(esMejoravitLead("mejoravit")).toBe(true);
  });

  it("generadores → false", () => {
    expect(esMejoravitLead("generadores")).toBe(false);
  });
});

describe("esGeneradoresLead", () => {
  it("solo generadores", () => {
    expect(esGeneradoresLead("generadores")).toBe(true);
    expect(esGeneradoresLead("mejoravit")).toBe(false);
  });
});
