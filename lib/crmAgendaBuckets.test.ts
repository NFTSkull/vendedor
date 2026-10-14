import { describe, expect, it } from "vitest";

import {
  agruparLeadsEnAgenda,
  clasificarLeadEnBucket,
  endOfCurrentWeekSunday,
  startOfZonedDay,
} from "@/lib/crmAgendaBuckets";

/** Jueves 18 jun 2026, 4:00 p.m. Ciudad de México (CDT, UTC-5) */
const AHORA_JUEVES_4PM = new Date("2026-06-18T21:00:00.000Z");

/** Domingo 22 jun 2026, 10:00 a.m. Ciudad de México */
const AHORA_DOMINGO_10AM = new Date("2026-06-22T15:00:00.000Z");

describe("clasificarLeadEnBucket", () => {
  it("lead vencido (fecha ayer, estado nuevo) → vencidos", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-17T18:00:00.000Z",
        "nuevo",
        AHORA_JUEVES_4PM,
      ),
    ).toBe("vencidos");
  });

  it("lead vencido pero ya contactado → excluido", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-17T18:00:00.000Z",
        "contactado",
        AHORA_JUEVES_4PM,
      ),
    ).toBeNull();
  });

  it("lead hoy a las 6pm siendo las 4pm actuales → hoy", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-18T23:00:00.000Z",
        "nuevo",
        AHORA_JUEVES_4PM,
      ),
    ).toBe("hoy");
  });

  it("lead hoy a las 10am siendo las 4pm → vencidos (pasó la hora)", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-18T15:00:00.000Z",
        "nuevo",
        AHORA_JUEVES_4PM,
      ),
    ).toBe("vencidos");
  });

  it("lead mañana → manana", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-19T20:00:00.000Z",
        "nuevo",
        AHORA_JUEVES_4PM,
      ),
    ).toBe("manana");
  });

  it("lead pasado mañana (sábado) → esta_semana", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-20T18:00:00.000Z",
        "nuevo",
        AHORA_JUEVES_4PM,
      ),
    ).toBe("esta_semana");
  });

  it("siendo domingo, lead el lunes → manana", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-23T18:00:00.000Z",
        "nuevo",
        AHORA_DOMINGO_10AM,
      ),
    ).toBe("manana");
  });

  it("lead sin fecha y estado nuevo → sin_agendar", () => {
    expect(clasificarLeadEnBucket(null, "nuevo", AHORA_JUEVES_4PM)).toBe(
      "sin_agendar",
    );
  });

  it("lead sin fecha pero contactado → excluido", () => {
    expect(clasificarLeadEnBucket(null, "contactado", AHORA_JUEVES_4PM)).toBeNull();
  });

  it("Compra de Casa contactado sin fecha → sin_agendar (no desaparece de la agenda)", () => {
    expect(
      clasificarLeadEnBucket(null, "contactado", AHORA_JUEVES_4PM, "compra_casa"),
    ).toBe("sin_agendar");
  });

  it.each(["mejoravit", "generadores", "paneles", null])(
    "%s contactado sin fecha → sigue excluido",
    (producto) => {
      expect(
        clasificarLeadEnBucket(null, "contactado", AHORA_JUEVES_4PM, producto),
      ).toBeNull();
    },
  );

  it("Compra de Casa no_interesado sin fecha → excluido", () => {
    expect(
      clasificarLeadEnBucket(null, "no_interesado", AHORA_JUEVES_4PM, "compra_casa"),
    ).toBeNull();
  });

  it("lead más allá del domingo de la semana → futuros", () => {
    const weekEnd = endOfCurrentWeekSunday(AHORA_JUEVES_4PM);
    const beyond = new Date(weekEnd.getTime() + 86_400_000).toISOString();
    expect(clasificarLeadEnBucket(beyond, "nuevo", AHORA_JUEVES_4PM)).toBe(
      "futuros",
    );
  });

  it("no_interesado → excluido", () => {
    expect(
      clasificarLeadEnBucket(
        "2026-06-19T20:00:00.000Z",
        "no_interesado",
        AHORA_JUEVES_4PM,
      ),
    ).toBeNull();
  });
});

describe("agruparLeadsEnAgenda", () => {
  it("pone en sin_agendar al lead de Compra de Casa contactado sin fecha", () => {
    const base = {
      whatsapp_phone: "5215550000000",
      fecha_contacto: null,
      created_at: "2026-06-18T15:00:00.000Z",
    };
    const agenda = agruparLeadsEnAgenda(
      [
        { ...base, id: "casa", producto: "compra_casa", estado: "contactado" },
        { ...base, id: "mv", producto: "mejoravit", estado: "contactado" },
      ],
      AHORA_JUEVES_4PM,
    );

    expect(agenda.sin_agendar.map((l) => l.id)).toEqual(["casa"]);
    expect(agenda.counts.sin_agendar).toBe(1);
  });
});

describe("startOfZonedDay", () => {
  it("ancla al inicio del día en MX", () => {
    const start = startOfZonedDay(AHORA_JUEVES_4PM);
    expect(start.getTime()).toBeLessThan(AHORA_JUEVES_4PM.getTime());
  });
});
