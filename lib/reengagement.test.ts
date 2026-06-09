import { describe, expect, it } from "vitest";

import {
  autorizadoCron,
  construirMensajeReengagement,
  elegibleParaToque,
  formatearMonto,
  leadTieneMonto,
  resolverToquePendiente,
} from "@/lib/reengagement";

const NOW = new Date("2026-06-05T12:10:00.000Z").getTime();

describe("reengagement", () => {
  it("autoriza cron de Vercel o Bearer CRON_SECRET", () => {
    process.env.CRON_SECRET = "cron-test-secret";

    expect(
      autorizadoCron(
        new Request("http://localhost", {
          headers: { "x-vercel-cron": "1" },
        }),
      ),
    ).toBe(true);

    expect(
      autorizadoCron(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer cron-test-secret" },
        }),
      ),
    ).toBe(true);

    expect(autorizadoCron(new Request("http://localhost"))).toBe(false);

    delete process.env.CRON_SECRET;
  });

  it("formatea montos con comas", () => {
    expect(formatearMonto(150000)).toBe("$150,000");
  });

  it("detecta lead con monto aprobado", () => {
    expect(
      leadTieneMonto({ monto_aprobado_min: 80000, monto_aprobado_max: 90000 }),
    ).toBe(true);
    expect(
      leadTieneMonto({ monto_aprobado_min: null, monto_aprobado_max: null }),
    ).toBe(false);
  });

  it("toque 1 solo entre 5 y 6 minutos sin toque previo", () => {
    expect(
      elegibleParaToque({
        touch: 1,
        minutesSinceLastIncoming: 5,
        reengagement1SentAt: null,
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      }),
    ).toBe(true);

    expect(
      elegibleParaToque({
        touch: 1,
        minutesSinceLastIncoming: 6,
        reengagement1SentAt: null,
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("toque 2 solo entre 20 y 21 minutos con toque 1 enviado", () => {
    expect(
      elegibleParaToque({
        touch: 2,
        minutesSinceLastIncoming: 20,
        reengagement1SentAt: "2026-06-05T11:50:00.000Z",
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      }),
    ).toBe(true);

    expect(
      elegibleParaToque({
        touch: 2,
        minutesSinceLastIncoming: 20,
        reengagement1SentAt: null,
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("omite si el lead se actualizó en los últimos 2 minutos", () => {
    expect(
      elegibleParaToque({
        touch: 1,
        minutesSinceLastIncoming: 5,
        reengagement1SentAt: null,
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:09:30.000Z",
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("genera mensaje de toque 1 para esperando_datos", () => {
    const mensaje = construirMensajeReengagement(
      1,
      "esperando_datos",
      {},
    );
    expect(mensaje).toContain("NSS");
    expect(mensaje).toContain("11 dígitos");
  });

  it("genera mensaje de horario con monto en toque 2", () => {
    const mensaje = construirMensajeReengagement(2, "esperando_horario", {
      monto_aprobado_min: 120000,
      monto_aprobado_max: 135000,
    });
    expect(mensaje).toContain("$120,000 – $135,000");
    expect(mensaje).toContain("no queremos que pierdas tu monto autorizado");
  });

  it("resuelve toque pendiente por prioridad", () => {
    expect(
      resolverToquePendiente({
        minutesSinceLastIncoming: 5,
        reengagement1SentAt: null,
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      }),
    ).toBe(1);

    expect(
      resolverToquePendiente({
        minutesSinceLastIncoming: 20,
        reengagement1SentAt: "2026-06-05T11:45:00.000Z",
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      }),
    ).toBe(2);
  });
});
