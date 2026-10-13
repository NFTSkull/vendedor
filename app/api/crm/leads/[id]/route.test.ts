import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  process.env.CRM_JWT_SECRET = "jwt-secret-de-prueba";
  return {
    advisors: [] as Row[],
    leads: [] as Row[],
    lead_actions: [] as Row[],
    /** Filtros aplicados al último UPDATE de leads, para comprobar la condición de propiedad. */
    filtrosUpdate: [] as string[],
    /** Simula una reasignación concurrente entre la autorización y el UPDATE. */
    reasignarAntesDeUpdate: null as string | null,
  };
});

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ from: (tabla: "advisors" | "leads" | "lead_actions") => builder(tabla) }),
}));

function builder(tabla: "advisors" | "leads" | "lead_actions") {
  const filtros: Array<(r: Row) => boolean> = [];
  const descripcion: string[] = [];
  let modo: "select" | "insert" | "update" = "select";
  let payload: Row = {};
  let columnas: string | null = null;

  const proyectar = (r: Row): Row => {
    if (!columnas || columnas === "*") return { ...r };
    return Object.fromEntries(
      columnas.split(",").map((c) => c.trim()).filter(Boolean).map((c) => [c, r[c] ?? null]),
    );
  };

  const ejecutar = (): Row[] => {
    if (modo === "insert") {
      db[tabla].push({ ...payload });
      return [payload];
    }
    if (modo === "update") {
      db.filtrosUpdate = descripcion;
      if (db.reasignarAntesDeUpdate) {
        db.leads.forEach((l) => (l.advisor_id = db.reasignarAntesDeUpdate));
      }
    }
    const rows = db[tabla].filter((r) => filtros.every((f) => f(r)));
    if (modo === "update") rows.forEach((r) => Object.assign(r, payload));
    return rows.map(proyectar);
  };

  const b = {
    select(cols?: string) {
      columnas = cols ?? "*";
      return b;
    },
    insert(row: Row) {
      modo = "insert";
      payload = row;
      return b;
    },
    update(patch: Row) {
      modo = "update";
      payload = patch;
      return b;
    },
    eq(col: string, val: unknown) {
      descripcion.push(`eq:${col}`);
      filtros.push((r) => r[col] === val);
      return b;
    },
    is(col: string, val: unknown) {
      descripcion.push(`is:${col}`);
      filtros.push((r) => (r[col] ?? null) === val);
      return b;
    },
    maybeSingle: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve({ data: ejecutar(), error: null }).then(resolve, reject);
    },
  };
  return b;
}

import { GET, PATCH } from "@/app/api/crm/leads/[id]/route";

const ASESOR = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const INACTIVO = "44444444-4444-4444-8444-444444444444";
const LEAD_PROPIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD_AJENO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD_SIN_ASIGNAR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function leadCompleto(id: string, advisorId: string | null): Row {
  return {
    id,
    advisor_id: advisorId,
    whatsapp_phone: "5218111111111",
    nss: "12345678901",
    horario: "",
    estado: "nuevo",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    producto: "mejoravit",
    nota: null,
    fecha_contacto: null,
    fecha_contacto_origen: null,
    precalificacion_status: "aprobado",
    precalificacion_resultado: {
      califica: true,
      mensaje: "OK",
      rfc: "PEPJ800101ABC",
      empresa: "EMPRESA SA",
      registroPatronal: "A1234567890",
      datos: { saldoSubcuenta: "120,000.00", montoCredito: "1" },
    },
    precalificado_at: "2026-10-01T00:00:00Z",
    nombre_infonavit: "JUAN PEREZ",
    saldo_subcuenta: "120,000.00",
    monto_base: 120000,
    monto_aprobado_min: 120000,
    monto_aprobado_max: 120000,
    capacidad_compra: null,
    pago_mensual: null,
    monto_credito: "1",
    tiene_mensaje_nuevo: true,
    reengagement_1_sent_at: null,
    tramite_mejoravit: { datos: { curp: { valor: "PEPJ800101HNLRRN09" }, ref1_celular: { valor: "8112345678" } } },
  };
}

async function token(sub: string, secreto = process.env.CRM_JWT_SECRET as string) {
  return new SignJWT({ sub, role: "advisor" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secreto));
}

async function solicitud(metodo: "GET" | "PATCH", leadId: string, opciones: { sub?: string; auth?: string; body?: unknown }) {
  const auth = opciones.auth ?? (opciones.sub ? `Bearer ${await token(opciones.sub)}` : undefined);
  const req = new Request(`http://localhost/api/crm/leads/${leadId}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    ...(opciones.body !== undefined ? { body: JSON.stringify(opciones.body) } : {}),
  });
  const ctx = { params: Promise.resolve({ id: leadId }) };
  return metodo === "GET" ? GET(req, ctx) : PATCH(req, ctx);
}

const contactado = { estado: "contactado" };

describe("/api/crm/leads/[id]", () => {
  beforeEach(() => {
    db.advisors.splice(0, db.advisors.length,
      { id: ASESOR, email: "asesor@example.com", activo: true },
      { id: OTRO, email: "otro@example.com", activo: true },
      { id: ADMIN, email: "admin@mejoravit.com", activo: true },
      { id: INACTIVO, email: "baja@example.com", activo: false },
    );
    db.leads.splice(0, db.leads.length,
      leadCompleto(LEAD_PROPIO, ASESOR),
      leadCompleto(LEAD_AJENO, OTRO),
      leadCompleto(LEAD_SIN_ASIGNAR, null),
    );
    db.lead_actions.splice(0, db.lead_actions.length);
    db.filtrosUpdate = [];
    db.reasignarAntesDeUpdate = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["GET", "PATCH"] as const)("%s sin token o con token inválido: 401", async (metodo) => {
    const body = metodo === "PATCH" ? contactado : undefined;
    expect((await solicitud(metodo, LEAD_PROPIO, { body })).status).toBe(401);
    expect((await solicitud(metodo, LEAD_PROPIO, { auth: "Bearer basura", body })).status).toBe(401);
    expect(
      (await solicitud(metodo, LEAD_PROPIO, { auth: `Bearer ${await token(ASESOR, "otro-secreto")}`, body })).status,
    ).toBe(401);
  });

  it.each(["GET", "PATCH"] as const)("%s con asesor inactivo o inexistente: 403", async (metodo) => {
    const body = metodo === "PATCH" ? contactado : undefined;
    expect((await solicitud(metodo, LEAD_PROPIO, { sub: INACTIVO, body })).status).toBe(403);
    expect(
      (await solicitud(metodo, LEAD_PROPIO, { sub: "99999999-9999-4999-8999-999999999999", body })).status,
    ).toBe(403);
    expect(db.leads.find((l) => l.id === LEAD_PROPIO)?.estado).toBe("nuevo");
  });

  it("GET de un lead propio: solo los campos de la pantalla, sin trámite ni datos del portal", async () => {
    const res = await solicitud("GET", LEAD_PROPIO, { sub: ASESOR });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toMatchObject({
      id: LEAD_PROPIO,
      nss: "12345678901",
      nombre_infonavit: "JUAN PEREZ",
      saldo_subcuenta: "120,000.00",
      precalificacion_resultado: { califica: true, mensaje: "OK", datos: { saldoSubcuenta: "120,000.00" } },
    });
    for (const campo of ["tramite_mejoravit", "advisor_id", "monto_credito", "tiene_mensaje_nuevo", "reengagement_1_sent_at"]) {
      expect(json).not.toHaveProperty(campo);
    }
    expect(JSON.stringify(json)).not.toMatch(/PEPJ800101|EMPRESA SA|A1234567890|8112345678/);
  });

  it("asesor con lead ajeno: 403 en GET y PATCH, sin modificar", async () => {
    expect((await solicitud("GET", LEAD_AJENO, { sub: ASESOR })).status).toBe(403);
    expect((await solicitud("PATCH", LEAD_AJENO, { sub: ASESOR, body: contactado })).status).toBe(403);
    expect(db.leads.find((l) => l.id === LEAD_AJENO)?.estado).toBe("nuevo");
    expect(db.lead_actions).toHaveLength(0);
  });

  it("admin: opera leads sin asignar y no los asignados (regla de la bandeja)", async () => {
    expect((await solicitud("GET", LEAD_SIN_ASIGNAR, { sub: ADMIN })).status).toBe(200);
    expect((await solicitud("PATCH", LEAD_SIN_ASIGNAR, { sub: ADMIN, body: contactado })).status).toBe(200);
    expect(db.filtrosUpdate).toEqual(["eq:id", "is:advisor_id"]);

    expect((await solicitud("GET", LEAD_PROPIO, { sub: ADMIN })).status).toBe(403);
    expect((await solicitud("PATCH", LEAD_PROPIO, { sub: ADMIN, body: contactado })).status).toBe(403);
  });

  it("PATCH propio: aplica la condición de propiedad, registra la acción y responde sin datos sensibles", async () => {
    const res = await solicitud("PATCH", LEAD_PROPIO, {
      sub: ASESOR,
      body: { estado: "contactado", nota: "Llamada" },
    });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(db.filtrosUpdate).toEqual(["eq:id", "eq:advisor_id"]);
    expect(json).toMatchObject({ id: LEAD_PROPIO, estado: "contactado" });
    expect(json).not.toHaveProperty("tramite_mejoravit");
    expect(json).not.toHaveProperty("advisor_id");
    expect(JSON.stringify(json)).not.toMatch(/PEPJ800101|EMPRESA SA|A1234567890|8112345678/);
    expect(db.lead_actions).toEqual([
      { lead_id: LEAD_PROPIO, advisor_id: ASESOR, accion: "contactado", nota: "Llamada" },
    ]);
  });

  it("PATCH con reasignación concurrente: el UPDATE condicionado no escribe y responde 403", async () => {
    db.reasignarAntesDeUpdate = OTRO;

    const res = await solicitud("PATCH", LEAD_PROPIO, { sub: ASESOR, body: contactado });

    expect(res.status).toBe(403);
    expect(db.leads.find((l) => l.id === LEAD_PROPIO)?.estado).toBe("nuevo");
    expect(db.lead_actions).toHaveLength(0);
  });

  it("valida ID y cuerpo: ID no UUID 404, cuerpo inválido 400", async () => {
    expect((await solicitud("GET", "lead-1", { sub: ASESOR })).status).toBe(404);
    expect((await solicitud("PATCH", LEAD_PROPIO, { sub: ASESOR, body: { estado: "otro" } })).status).toBe(400);
  });

  it("no registra tokens, NSS ni teléfonos en logs", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const jwt = await token(ASESOR);
    await solicitud("GET", LEAD_PROPIO, { auth: `Bearer ${jwt}` });
    await solicitud("PATCH", LEAD_AJENO, { auth: `Bearer ${jwt}`, body: contactado });
    await solicitud("GET", LEAD_PROPIO, { auth: "Bearer basura" });

    const escrito = JSON.stringify(logs.map((l) => l.mock.calls));
    for (const sensible of [jwt, "12345678901", "5218111111111"]) {
      expect(escrito).not.toContain(sensible);
    }
  });
});
