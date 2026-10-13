import { beforeEach, describe, expect, it, vi } from "vitest";

const fila = vi.hoisted(() => ({ tramite_mejoravit: null as Record<string, unknown> | null }));
const escrituras = vi.hoisted(() => ({ total: 0 }));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { ...fila, nss: "12345678901", precalificacion_status: "aprobado" },
            error: null,
          }),
        }),
      }),
      update: (patch: { tramite_mejoravit: Record<string, unknown> }) => {
        const filtros: Array<() => boolean> = [];
        const builder = {
          eq(col: string, val: string) {
            if (col === "tramite_mejoravit->>version") {
              filtros.push(() => String(fila.tramite_mejoravit?.version) === val);
            }
            return builder;
          },
          is() {
            filtros.push(() => fila.tramite_mejoravit === null);
            return builder;
          },
          select: async () => {
            if (!filtros.every((f) => f())) return { data: [], error: null };
            escrituras.total++;
            fila.tramite_mejoravit = patch.tramite_mejoravit;
            return { data: [{ id: "lead-1" }], error: null };
          },
        };
        return builder;
      },
    }),
  }),
}));

import { estimarCreditoMejoravit } from "@/lib/mejoravitCredito";
import {
  prepararTramiteTrasPrecalificacion,
  type TramiteMejoravit,
} from "@/lib/tramiteMejoravit";
import { guardarTramiteMejoravit, leerLeadConTramite } from "@/lib/tramiteMejoravitRepo";

const AHORA = "2026-10-13T12:00:00.000Z";

function base(): TramiteMejoravit {
  return prepararTramiteTrasPrecalificacion(null, {
    nss: "12345678901",
    credito: estimarCreditoMejoravit(100000),
    portal: { nombre: null, rfc: null, rfcConHomoclave: false, empresa: null, registroPatronal: null },
    celularWhatsapp: "8111111111",
    ahora: AHORA,
  });
}

function conDato(t: TramiteMejoravit, campo: "nombres" | "correo", valor: string): TramiteMejoravit {
  return {
    ...t,
    datos: { ...t.datos, [campo]: { valor, procedencia: "cliente", actualizadoAt: AHORA } },
  };
}

describe("guardarTramiteMejoravit (concurrencia optimista)", () => {
  beforeEach(() => {
    fila.tramite_mejoravit = null;
    escrituras.total = 0;
  });

  it("primera escritura: solo aplica si aún no hay trámite y deja versión 1", async () => {
    const r = await guardarTramiteMejoravit("lead-1", null, () => ({ tramite: base() }));
    expect(r?.tramite.version).toBe(1);
    expect((await leerLeadConTramite("lead-1"))?.tramite?.version).toBe(1);
  });

  it("si otro mensaje guardó primero, relee y recalcula sin perder ninguno de los dos datos", async () => {
    await guardarTramiteMejoravit("lead-1", null, () => ({ tramite: base() }));
    const leido = (await leerLeadConTramite("lead-1"))!.tramite!;

    // Otro mensaje (otra instancia) guarda el nombre sobre la misma versión leída.
    await guardarTramiteMejoravit("lead-1", leido, (actual) => ({
      tramite: conDato(actual!, "nombres", "Juan"),
    }));

    const llamadas: number[] = [];
    const r = await guardarTramiteMejoravit("lead-1", leido, (actual) => {
      llamadas.push(actual!.version);
      return { tramite: conDato(actual!, "correo", "juan@example.com") };
    });

    expect(llamadas).toEqual([1, 2]);
    expect(r?.tramite.version).toBe(3);
    const final = (await leerLeadConTramite("lead-1"))!.tramite!;
    expect(final.datos.nombres?.valor).toBe("Juan");
    expect(final.datos.correo?.valor).toBe("juan@example.com");
    expect(escrituras.total).toBe(3);
  });

  it("no sobrescribe un trámite existente cuando se creía que no había", async () => {
    await guardarTramiteMejoravit("lead-1", null, () => ({
      tramite: conDato(base(), "nombres", "Juan"),
    }));
    const r = await guardarTramiteMejoravit("lead-1", null, (actual) => ({
      tramite: actual ?? base(),
    }));
    expect(r?.tramite.datos.nombres?.valor).toBe("Juan");
  });
});
