import { describe, expect, it } from "vitest";

import {
  enriquecerLeadConUltimoMensaje,
  ordenarLeadsPorActividad,
  type UltimoMensajeLead,
} from "@/lib/crmLeadsList";

const baseUltimo: UltimoMensajeLead = {
  ultimo_mensaje: null,
  ultimo_mensaje_fecha: null,
  ultimo_mensaje_direccion: null,
};

describe("ordenarLeadsPorActividad", () => {
  it("ordena por ultimo_mensaje_fecha DESC; sin mensajes al final por created_at", () => {
    const leads = [
      {
        id: "a",
        created_at: "2026-06-01T10:00:00Z",
        ...baseUltimo,
        ultimo_mensaje_fecha: "2026-06-05T12:00:00Z",
        ultimo_mensaje: "viejo",
        ultimo_mensaje_direccion: "entrante" as const,
      },
      {
        id: "b",
        created_at: "2026-06-04T10:00:00Z",
        ...baseUltimo,
        ultimo_mensaje_fecha: "2026-06-10T08:00:00Z",
        ultimo_mensaje: "reciente",
        ultimo_mensaje_direccion: "saliente" as const,
      },
      {
        id: "c",
        created_at: "2026-06-09T10:00:00Z",
        ...baseUltimo,
      },
      {
        id: "d",
        created_at: "2026-06-08T10:00:00Z",
        ...baseUltimo,
      },
    ];

    const sorted = ordenarLeadsPorActividad(leads);
    expect(sorted.map((l) => l.id)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("enriquecerLeadConUltimoMensaje", () => {
  it("adjunta campos de último mensaje o null", () => {
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
    });
  });
});
