import { describe, expect, it } from "vitest";

import {
  construirMensajeReengagementGeneradores,
  conversacionElegibleGeneradores,
  dentroVentana24hWhatsApp,
  elegibleParaToqueGeneradores,
  GEN_TOQUE_1_MIN_MINUTES,
  GEN_TOQUE_2_MIN_MINUTES,
  GEN_WHATSAPP_VENTANA_MAX_MINUTES,
  parseGenStep,
  resolverToquePendienteGeneradores,
} from "@/lib/reengagementGeneradores";

describe("reengagementGeneradores", () => {
  describe("parseGenStep", () => {
    it("acepta tipo, equipos y horario", () => {
      expect(parseGenStep({ genStep: "tipo" })).toBe("tipo");
      expect(parseGenStep({ genStep: "equipos" })).toBe("equipos");
      expect(parseGenStep({ genStep: "horario" })).toBe("horario");
    });

    it("rechaza pasos inválidos o data vacía", () => {
      expect(parseGenStep({ genStep: "otro" })).toBeNull();
      expect(parseGenStep(null)).toBeNull();
      expect(parseGenStep({})).toBeNull();
    });
  });

  describe("conversacionElegibleGeneradores", () => {
    const base = {
      producto: "generadores" as const,
      state: "inicio",
      genStep: "tipo" as const,
      leadEstado: "nuevo",
    };

    it("acepta flujo abandonado en paso válido", () => {
      expect(conversacionElegibleGeneradores(base)).toBe(true);
    });

    it("rechaza si finalizado", () => {
      expect(
        conversacionElegibleGeneradores({ ...base, state: "finalizado" }),
      ).toBe(false);
    });

    it("rechaza si lead contactado (mismo criterio que webhook silencioso)", () => {
      expect(
        conversacionElegibleGeneradores({ ...base, leadEstado: "contactado" }),
      ).toBe(false);
      expect(
        conversacionElegibleGeneradores({
          ...base,
          leadEstado: "no_interesado",
        }),
      ).toBe(false);
    });

    it("rechaza sin genStep o producto distinto", () => {
      expect(
        conversacionElegibleGeneradores({ ...base, genStep: null }),
      ).toBe(false);
      expect(
        conversacionElegibleGeneradores({ ...base, producto: "mejoravit" }),
      ).toBe(false);
    });
  });

  describe("ventanas de tiempo", () => {
    it("toque 1 entre 3h y 3h+ventana", () => {
      expect(
        elegibleParaToqueGeneradores({
          touch: 1,
          minutesSinceLastIncoming: GEN_TOQUE_1_MIN_MINUTES,
          genReengagement1SentAt: null,
          genReengagement2SentAt: null,
        }),
      ).toBe(true);

      expect(
        elegibleParaToqueGeneradores({
          touch: 1,
          minutesSinceLastIncoming: GEN_TOQUE_1_MIN_MINUTES + 9,
          genReengagement1SentAt: null,
          genReengagement2SentAt: null,
        }),
      ).toBe(true);

      expect(
        elegibleParaToqueGeneradores({
          touch: 1,
          minutesSinceLastIncoming: GEN_TOQUE_1_MIN_MINUTES - 1,
          genReengagement1SentAt: null,
          genReengagement2SentAt: null,
        }),
      ).toBe(false);
    });

    it("toque 2 entre 20h y 20h+ventana con toque 1 enviado", () => {
      expect(
        elegibleParaToqueGeneradores({
          touch: 2,
          minutesSinceLastIncoming: GEN_TOQUE_2_MIN_MINUTES,
          genReengagement1SentAt: "2026-06-01T10:00:00.000Z",
          genReengagement2SentAt: null,
        }),
      ).toBe(true);

      expect(
        elegibleParaToqueGeneradores({
          touch: 2,
          minutesSinceLastIncoming: GEN_TOQUE_2_MIN_MINUTES,
          genReengagement1SentAt: null,
          genReengagement2SentAt: null,
        }),
      ).toBe(false);
    });

    it("no envía después de 24h", () => {
      expect(dentroVentana24hWhatsApp(GEN_WHATSAPP_VENTANA_MAX_MINUTES - 1)).toBe(
        true,
      );
      expect(dentroVentana24hWhatsApp(GEN_WHATSAPP_VENTANA_MAX_MINUTES)).toBe(
        false,
      );

      expect(
        elegibleParaToqueGeneradores({
          touch: 1,
          minutesSinceLastIncoming: GEN_WHATSAPP_VENTANA_MAX_MINUTES,
          genReengagement1SentAt: null,
          genReengagement2SentAt: null,
        }),
      ).toBe(false);
    });

    it("anti-duplicado: no repite toque ya enviado", () => {
      expect(
        elegibleParaToqueGeneradores({
          touch: 1,
          minutesSinceLastIncoming: GEN_TOQUE_1_MIN_MINUTES,
          genReengagement1SentAt: "2026-06-01T08:00:00.000Z",
          genReengagement2SentAt: null,
        }),
      ).toBe(false);

      expect(
        elegibleParaToqueGeneradores({
          touch: 2,
          minutesSinceLastIncoming: GEN_TOQUE_2_MIN_MINUTES,
          genReengagement1SentAt: "2026-06-01T08:00:00.000Z",
          genReengagement2SentAt: "2026-06-01T09:00:00.000Z",
        }),
      ).toBe(false);
    });

    it("resuelve toque pendiente por prioridad", () => {
      expect(
        resolverToquePendienteGeneradores({
          minutesSinceLastIncoming: GEN_TOQUE_1_MIN_MINUTES,
          genReengagement1SentAt: null,
          genReengagement2SentAt: null,
        }),
      ).toBe(1);

      expect(
        resolverToquePendienteGeneradores({
          minutesSinceLastIncoming: GEN_TOQUE_2_MIN_MINUTES,
          genReengagement1SentAt: "2026-06-01T08:00:00.000Z",
          genReengagement2SentAt: null,
        }),
      ).toBe(2);
    });
  });

  describe("mensajes por genStep", () => {
    it("tipo", () => {
      const msg = construirMensajeReengagementGeneradores("tipo");
      expect(msg).toContain("industrial o residencial");
    });

    it("equipos", () => {
      const msg = construirMensajeReengagementGeneradores("equipos");
      expect(msg).toContain("equipos necesitas respaldar");
    });

    it("horario", () => {
      const msg = construirMensajeReengagementGeneradores("horario");
      expect(msg).toContain("Energrum");
      expect(msg).toContain("día y horario");
    });
  });
});
