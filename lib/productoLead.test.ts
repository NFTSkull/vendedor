import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADVISOR_ID_GUILLERMO } from "@/lib/detectarProducto";

type Lead = { id: string; producto: string; advisor_id: string | null };

const db = vi.hoisted(() => ({
  leads: new Map<string, { id: string; producto: string; advisor_id: string | null }>(),
  acciones: [] as Array<Record<string, unknown>>,
  errorUpdate: null as { message: string } | null,
}));

function updateLeads(patch: Partial<Lead>) {
  let id: string | null = null;
  let soloSinAsesor = false;
  const ejecutar = () => {
    if (db.errorUpdate) return { data: null, error: db.errorUpdate };
    const lead = id ? db.leads.get(id) : undefined;
    if (!lead || (soloSinAsesor && lead.advisor_id !== null)) return { data: [], error: null };
    db.leads.set(lead.id, { ...lead, ...patch });
    return { data: [{ id: lead.id }], error: null };
  };
  const builder = {
    eq(_col: string, val: string) {
      id = val;
      return builder;
    },
    is() {
      soloSinAsesor = true;
      return builder;
    },
    select() {
      return builder;
    },
    then<T>(resolve: (v: ReturnType<typeof ejecutar>) => T) {
      return Promise.resolve(ejecutar()).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "leads") return { update: updateLeads };
      return {
        insert: async (row: Record<string, unknown>) => {
          db.acciones.push(row);
          return { error: null };
        },
      };
    },
  }),
}));

import {
  asignarAsesorPorDefectoSiVacio,
  sincronizarProductoLead,
} from "@/lib/productoLead";

function sembrarLead(lead: Lead) {
  db.leads.set(lead.id, lead);
}

beforeEach(() => {
  db.leads.clear();
  db.acciones.length = 0;
  db.errorUpdate = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sincronizarProductoLead", () => {
  it("actualiza leads.producto, asigna asesor por defecto y deja ambas acciones sin advisor_id", async () => {
    sembrarLead({ id: "l1", producto: "sin_clasificar", advisor_id: null });

    await expect(sincronizarProductoLead("l1", "mejoravit", "menu")).resolves.toBe(true);

    expect(db.leads.get("l1")).toEqual({
      id: "l1",
      producto: "mejoravit",
      advisor_id: ADVISOR_ID_GUILLERMO,
    });
    expect(db.acciones).toEqual([
      {
        lead_id: "l1",
        advisor_id: null,
        accion: "cambio_producto_automatico",
        nota: "menu: mejoravit",
      },
      {
        lead_id: "l1",
        advisor_id: null,
        accion: "asesor_asignado_automatico",
        nota: `mejoravit: ${ADVISOR_ID_GUILLERMO}`,
      },
    ]);
  });

  it("no reemplaza un asesor ya asignado", async () => {
    sembrarLead({ id: "l2", producto: "mejoravit", advisor_id: "asesor-previo" });

    await sincronizarProductoLead("l2", "compra_casa", "comando");

    expect(db.leads.get("l2")).toMatchObject({
      producto: "compra_casa",
      advisor_id: "asesor-previo",
    });
    expect(db.acciones.map((a) => a.accion)).toEqual(["cambio_producto_automatico"]);
  });

  it.each(["generadores", "paneles"] as const)(
    "%s: sincroniza el producto pero no asigna asesor",
    async (producto) => {
      sembrarLead({ id: "l3", producto: "sin_clasificar", advisor_id: null });

      await sincronizarProductoLead("l3", producto, "primer_mensaje");

      expect(db.leads.get("l3")).toEqual({ id: "l3", producto, advisor_id: null });
      expect(db.acciones.map((a) => a.accion)).toEqual(["cambio_producto_automatico"]);
    },
  );

  it("si falla el update del producto, no registra acciones ni asigna", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sembrarLead({ id: "l4", producto: "sin_clasificar", advisor_id: null });
    db.errorUpdate = { message: "boom" };

    await expect(sincronizarProductoLead("l4", "mejoravit", "menu")).resolves.toBe(false);

    expect(db.acciones).toEqual([]);
  });
});

describe("asignarAsesorPorDefectoSiVacio", () => {
  it("usa DEFAULT_ADVISOR_COMPRA_CASA y devuelve el asesor asignado", async () => {
    vi.stubEnv("DEFAULT_ADVISOR_COMPRA_CASA", "asesor-cc");
    sembrarLead({ id: "l5", producto: "compra_casa", advisor_id: null });

    await expect(asignarAsesorPorDefectoSiVacio("l5", "compra_casa")).resolves.toBe("asesor-cc");
    expect(db.leads.get("l5")?.advisor_id).toBe("asesor-cc");
  });

  it("devuelve null cuando el lead ya tenía asesor", async () => {
    sembrarLead({ id: "l6", producto: "mejoravit", advisor_id: "otro" });

    await expect(asignarAsesorPorDefectoSiVacio("l6", "mejoravit")).resolves.toBeNull();
    expect(db.acciones).toEqual([]);
  });
});
