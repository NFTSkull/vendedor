import { describe, expect, it } from "vitest";

import { datetimeLocalToIso, isoToDatetimeLocal } from "./crmFechaContacto";

describe("crmFechaContacto", () => {
  it("convierte ISO a datetime-local y de vuelta en la misma zona", () => {
    const iso = "2026-06-10T18:30:00.000Z";
    const local = isoToDatetimeLocal(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const roundTrip = datetimeLocalToIso(local);
    expect(roundTrip).toBe(iso);
  });

  it("datetime-local vacío devuelve null", () => {
    expect(datetimeLocalToIso("")).toBeNull();
    expect(datetimeLocalToIso("   ")).toBeNull();
  });

  it("ISO inválido devuelve cadena vacía al mostrar", () => {
    expect(isoToDatetimeLocal("no-es-fecha")).toBe("");
  });
});
