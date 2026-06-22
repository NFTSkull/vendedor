import { describe, expect, it } from "vitest";

import {
  calcularUltimaActividadAt,
  enriquecerLeadConUltimoMensaje,
  ordenarLeadsPorActividad,
} from "@/lib/crmLeadsList";

function leadEnriquecido(args: {
  id: string;
  created_at: string;
  ultimo_mensaje_fecha?: string | null;
  ultimo_mensaje?: string | null;
  ultimo_mensaje_direccion?: "entrante" | "saliente" | null;
}) {
  const map = new Map<
    string,
    {
      ultimo_mensaje: string | null;
      ultimo_mensaje_fecha: string | null;
      ultimo_mensaje_direccion: "entrante" | "saliente" | null;
    }
  >();

  if (args.ultimo_mensaje_fecha) {
    map.set(args.id, {
      ultimo_mensaje: args.ultimo_mensaje ?? "msg",
      ultimo_mensaje_fecha: args.ultimo_mensaje_fecha,
      ultimo_mensaje_direccion: args.ultimo_mensaje_direccion ?? "entrante",
    });
  }

  return enriquecerLeadConUltimoMensaje(
    { id: args.id, created_at: args.created_at },
    map,
  );
}

describe("calcularUltimaActividadAt", () => {
  it("usa ultimo_mensaje_fecha si existe, si no created_at", () => {
    expect(
      calcularUltimaActividadAt({
        id: "a",
        created_at: "2026-06-01T08:00:00Z",
        ultimo_mensaje_fecha: "2026-06-10T10:00:00Z",
      }),
    ).toBe("2026-06-10T10:00:00Z");

    expect(
      calcularUltimaActividadAt({
        id: "b",
        created_at: "2026-06-10T12:00:00Z",
        ultimo_mensaje_fecha: null,
      }),
    ).toBe("2026-06-10T12:00:00Z");
  });
});

describe("ordenarLeadsPorActividad", () => {
  it("A (msg hoy 10am) antes que B (creado hoy 8am sin mensajes nuevos)", () => {
    const a = leadEnriquecido({
      id: "a",
      created_at: "2026-06-09T08:00:00Z",
      ultimo_mensaje_fecha: "2026-06-10T10:00:00Z",
    });
    const b = leadEnriquecido({
      id: "b",
      created_at: "2026-06-10T08:00:00Z",
    });

    const sorted = ordenarLeadsPorActividad([b, a]);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("C sin mensajes ordena por created_at entre el resto", () => {
    const a = leadEnriquecido({
      id: "a",
      created_at: "2026-06-09T08:00:00Z",
      ultimo_mensaje_fecha: "2026-06-10T10:00:00Z",
    });
    const b = leadEnriquecido({
      id: "b",
      created_at: "2026-06-10T08:00:00Z",
    });
    const c = leadEnriquecido({
      id: "c",
      created_at: "2026-06-10T12:00:00Z",
    });

    const sorted = ordenarLeadsPorActividad([a, b, c]);
    expect(sorted.map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(c.ultima_actividad_at).toBe("2026-06-10T12:00:00Z");
  });
});

describe("enriquecerLeadConUltimoMensaje", () => {
  it("adjunta campos de último mensaje y ultima_actividad_at", () => {
    const map = new Map([
      [
        "lead-1",
        {
          ultimo_mensaje: "Hola",
          ultimo_mensaje_fecha: "2026-06-01T12:00:00Z",
          ultimo_mensaje_direccion: "entrante" as const,
        },
      ],
    ]);

    expect(
      enriquecerLeadConUltimoMensaje(
        { id: "lead-1", created_at: "2026-06-01T10:00:00Z" },
        map,
      ),
    ).toMatchObject({
      ultimo_mensaje: "Hola",
      ultimo_mensaje_direccion: "entrante",
      ultima_actividad_at: "2026-06-01T12:00:00Z",
    });

    expect(
      enriquecerLeadConUltimoMensaje(
        { id: "lead-2", created_at: "2026-06-01T10:00:00Z" },
        map,
      ),
    ).toMatchObject({
      ultimo_mensaje: null,
      ultimo_mensaje_fecha: null,
      ultimo_mensaje_direccion: null,
      ultima_actividad_at: "2026-06-01T10:00:00Z",
    });
  });
});
