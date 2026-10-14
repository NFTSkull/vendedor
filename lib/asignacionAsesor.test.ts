import { afterEach, describe, expect, it, vi } from "vitest";

import { asesorPorDefecto, elegirAsesorParaLead } from "@/lib/asignacionAsesor";
import { ADVISOR_ID_GUILLERMO } from "@/lib/detectarProducto";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("asesorPorDefecto", () => {
  it("sin variables configuradas, Mejoravit y Compra de Casa van con Guillermo", () => {
    vi.stubEnv("DEFAULT_ADVISOR_MEJORAVIT", "");
    vi.stubEnv("DEFAULT_ADVISOR_COMPRA_CASA", "   ");

    expect(ADVISOR_ID_GUILLERMO).toBe("2d46ad6c-dc1a-4089-81ec-47eb0be7472e");
    expect(asesorPorDefecto("mejoravit")).toBe(ADVISOR_ID_GUILLERMO);
    expect(asesorPorDefecto("compra_casa")).toBe(ADVISOR_ID_GUILLERMO);
  });

  it("respeta DEFAULT_ADVISOR_MEJORAVIT y DEFAULT_ADVISOR_COMPRA_CASA por separado", () => {
    vi.stubEnv("DEFAULT_ADVISOR_MEJORAVIT", " asesor-mv ");
    vi.stubEnv("DEFAULT_ADVISOR_COMPRA_CASA", "asesor-cc");

    expect(asesorPorDefecto("mejoravit")).toBe("asesor-mv");
    expect(asesorPorDefecto("compra_casa")).toBe("asesor-cc");
  });

  it.each(["generadores", "paneles", "sin_clasificar"] as const)(
    "%s no tiene asesor automático",
    (producto) => {
      vi.stubEnv("DEFAULT_ADVISOR_MEJORAVIT", "asesor-mv");
      expect(asesorPorDefecto(producto)).toBeNull();
    },
  );
});

describe("elegirAsesorParaLead", () => {
  it("delega en el asesor por defecto del producto", async () => {
    vi.stubEnv("DEFAULT_ADVISOR_COMPRA_CASA", "asesor-cc");

    await expect(elegirAsesorParaLead({ producto: "compra_casa" })).resolves.toBe("asesor-cc");
    await expect(elegirAsesorParaLead({ producto: "generadores" })).resolves.toBeNull();
    await expect(elegirAsesorParaLead({ producto: "paneles" })).resolves.toBeNull();
  });
});
