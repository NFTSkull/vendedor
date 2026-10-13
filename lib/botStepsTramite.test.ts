import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interpretar: vi.fn(),
  leer: vi.fn(),
  guardar: vi.fn(),
}));

vi.mock("@/lib/claudeAssistant", () => ({
  claudeDisponible: () => true,
  interpretarMensajeTramite: mocks.interpretar,
}));

vi.mock("@/lib/tramiteMejoravitRepo", () => ({
  leerLeadConTramite: mocks.leer,
  guardarTramiteMejoravit: mocks.guardar,
}));

vi.mock("@/lib/messagesDb", () => ({
  buscarLeadPorTelefono: vi.fn(async () => null),
}));

import { MSG_TRAMITE_NO_DISPONIBLE, procesarTramiteMejoravit } from "@/lib/botStepsTramite";
import { estimarCreditoMejoravit } from "@/lib/mejoravitCredito";
import {
  prepararTramiteTrasPrecalificacion,
  type TramiteMejoravit,
} from "@/lib/tramiteMejoravit";

const PHONE = "5218111111111";

function tramite(etapa: TramiteMejoravit["etapa"] = "oferta"): TramiteMejoravit {
  const t = prepararTramiteTrasPrecalificacion(null, {
    nss: "12345678901",
    credito: estimarCreditoMejoravit(100000),
    portal: { nombre: null, rfc: null, rfcConHomoclave: false, empresa: null, registroPatronal: null },
    celularWhatsapp: "8111111111",
    ahora: "2026-10-13T12:00:00.000Z",
  });
  return {
    ...t,
    version: 1,
    etapa,
    consentimiento: etapa === "captura" ? { aceptado: true, respondidoAt: t.creadoAt } : null,
    campoActual: etapa === "captura" ? "nombres" : null,
  };
}

function leadCon(t: TramiteMejoravit | null) {
  return {
    tramite: t,
    nss: "12345678901",
    precalificacionStatus: "aprobado",
    precalificacionResultado: { califica: true, nss: "12345678901", datos: { saldoSubcuenta: "100000" } },
    precalificadoAt: "2026-10-13T11:00:00.000Z",
    saldoSubcuenta: "100000",
  };
}

describe("procesarTramiteMejoravit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    mocks.guardar.mockImplementation(
      async (_id: string, leido: TramiteMejoravit | null, calcular: (t: TramiteMejoravit | null) => { tramite: TramiteMejoravit }) =>
        calcular(leido),
    );
  });

  it("sí/no se resuelve localmente: no llama a Claude", async () => {
    mocks.leer.mockResolvedValue(leadCon(tramite("oferta")));

    const r = await procesarTramiteMejoravit({ phone: PHONE, texto: "sí", leadId: "lead-1" });

    expect(r).toContain("¿Autorizas el uso de tus datos");
    expect(mocks.interpretar).not.toHaveBeenCalled();
    expect(mocks.guardar).toHaveBeenCalledTimes(1);
  });

  it("texto libre: una sola llamada a Claude y guarda lo extraído", async () => {
    mocks.leer.mockResolvedValue(leadCon(tramite("captura")));
    mocks.interpretar.mockResolvedValue({
      intencion: "dato",
      datos: { nombres: "Juan Carlos", apellido_paterno: "Pérez", apellido_materno: "López" },
      respuesta: null,
    });

    const r = await procesarTramiteMejoravit({
      phone: PHONE,
      texto: "Me llamo Juan Carlos Pérez López",
      leadId: "lead-1",
    });

    expect(mocks.interpretar).toHaveBeenCalledTimes(1);
    expect(r).toContain("CURP");
    const guardado = await mocks.guardar.mock.results[0].value;
    expect(guardado.tramite.datos.apellido_materno.valor).toBe("López");
  });

  it("si el trámite no se pudo guardar al precalificar, lo reconstruye con la precalificación del lead", async () => {
    mocks.leer.mockResolvedValue(leadCon(null));

    const r = await procesarTramiteMejoravit({
      phone: PHONE,
      texto: "sí",
      leadId: "lead-1",
      nssConversacion: "12345678901",
    });

    expect(mocks.guardar).toHaveBeenCalledTimes(2);
    expect(r).toContain("¿Autorizas el uso de tus datos");
  });

  it("no reconstruye con una precalificación de otro NSS ni sin NSS en el chat", async () => {
    mocks.leer.mockResolvedValue(leadCon(null));

    for (const nssConversacion of ["98765432109", null]) {
      const r = await procesarTramiteMejoravit({
        phone: PHONE,
        texto: "sí",
        leadId: "lead-1",
        nssConversacion,
      });
      expect(r).toBe(MSG_TRAMITE_NO_DISPONIBLE);
    }
    expect(mocks.guardar).not.toHaveBeenCalled();
  });

  it("si no se puede leer ni guardar, responde un problema temporal sin perder el avance", async () => {
    mocks.leer.mockResolvedValue(null);
    expect(await procesarTramiteMejoravit({ phone: PHONE, texto: "sí", leadId: "lead-1" })).toBe(
      MSG_TRAMITE_NO_DISPONIBLE,
    );

    mocks.leer.mockResolvedValue(leadCon(tramite("oferta")));
    mocks.guardar.mockResolvedValue(null);
    expect(await procesarTramiteMejoravit({ phone: PHONE, texto: "sí", leadId: "lead-1" })).toBe(
      MSG_TRAMITE_NO_DISPONIBLE,
    );
  });
});
