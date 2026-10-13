import { describe, expect, it } from "vitest";

import {
  autorizadoCron,
  construirMensajeReengagement,
  elegibleParaToque,
  estadoPermiteReengagement,
  formatearMonto,
  leadTieneMonto,
  resolverToquePendiente,
} from "@/lib/reengagement";

const NOW = new Date("2026-06-05T12:10:00.000Z").getTime();

describe("reengagement", () => {
  it("solo autoriza Bearer CRON_SECRET; x-vercel-cron no basta", () => {
    process.env.CRON_SECRET = "cron-test-secret";

    expect(
      autorizadoCron(
        new Request("http://localhost", {
          headers: { "x-vercel-cron": "1" },
        }),
      ),
    ).toBe(false);

    expect(
      autorizadoCron(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer otro-secreto" },
        }),
      ),
    ).toBe(false);

    expect(
      autorizadoCron(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer cron-test-secret" },
        }),
      ),
    ).toBe(true);

    expect(autorizadoCron(new Request("http://localhost"))).toBe(false);

    delete process.env.CRON_SECRET;
    expect(
      autorizadoCron(
        new Request("http://localhost", {
          headers: { Authorization: "Bearer " },
        }),
      ),
    ).toBe(false);
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

  it("toque 1 entre 5 y 15 minutos sin toque previo", () => {
    const toque1 = (minutos: number, enviado: string | null = null) =>
      elegibleParaToque({
        touch: 1,
        minutesSinceLastIncoming: minutos,
        reengagement1SentAt: enviado,
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      });

    expect(toque1(4)).toBe(false);
    expect(toque1(5)).toBe(true);
    expect(toque1(14)).toBe(true);
    expect(toque1(15)).toBe(false);
    expect(toque1(6, "2026-06-05T12:04:00.000Z")).toBe(false);
  });

  it("toque 2 entre 20 y 30 minutos, al menos 10 minutos después del toque 1", () => {
    const toque2 = (minutos: number, toque1At: string | null) =>
      elegibleParaToque({
        touch: 2,
        minutesSinceLastIncoming: minutos,
        reengagement1SentAt: toque1At,
        reengagement2SentAt: null,
        leadUpdatedAt: "2026-06-05T12:00:00.000Z",
        nowMs: NOW,
      });

    expect(toque2(19, "2026-06-05T11:55:00.000Z")).toBe(false);
    expect(toque2(29, "2026-06-05T11:55:00.000Z")).toBe(true);
    expect(toque2(30, "2026-06-05T11:55:00.000Z")).toBe(false);
    expect(toque2(22, "2026-06-05T12:01:00.000Z")).toBe(false);
  });

  it("toque 2 solo con toque 1 enviado", () => {
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

  it("no pide horario de contacto: esperando_horario y el trámite no reciben toques", () => {
    expect(estadoPermiteReengagement("esperando_horario")).toBe(false);
    expect(estadoPermiteReengagement("tramite_mejoravit")).toBe(false);
    expect(
      construirMensajeReengagement(2, "esperando_horario", {
        monto_aprobado_min: 120000,
        monto_aprobado_max: 135000,
      }),
    ).toBeNull();
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
