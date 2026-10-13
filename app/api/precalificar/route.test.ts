import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => {
  process.env.SCRAPER_SERVICE_URL = "https://scraper.test";
  process.env.SCRAPER_SECRET = "scraper-secret";
  process.env.CRM_JWT_SECRET = "jwt-secret-de-prueba";
  return { advisors: [] as Row[], leads: [] as Row[], lead_actions: [] as Row[] };
});

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ from: (tabla: keyof typeof db) => builder(tabla) }),
}));

let secuencia = 0;

/** Subconjunto de PostgREST que usa la ruta, sobre arreglos en memoria. */
function builder(tabla: keyof typeof db) {
  const filtros: Array<(r: Row) => boolean> = [];
  let modo: "select" | "insert" | "update" = "select";
  let payload: Row = {};
  let soloConteo = false;
  let orden: { col: string; asc: boolean } | null = null;
  let limite: number | null = null;

  const ejecutar = (): Row[] => {
    if (modo === "insert") {
      secuencia += 1;
      const row = {
        id: `00000000-0000-4000-8000-${String(secuencia).padStart(12, "0")}`,
        created_at: new Date(Date.now() + secuencia).toISOString(),
        ...payload,
      };
      db[tabla].push(row);
      return [row];
    }
    let rows = db[tabla].filter((r) => filtros.every((f) => f(r)));
    if (modo === "update") {
      rows.forEach((r) => Object.assign(r, payload));
      return rows;
    }
    if (orden) {
      const { col, asc } = orden;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    return limite === null ? rows : rows.slice(0, limite);
  };

  const b = {
    select(_cols?: string, opts?: { head?: boolean }) {
      if (opts?.head) soloConteo = true;
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
      filtros.push((r) => r[col] === val);
      return b;
    },
    in(col: string, vals: unknown[]) {
      filtros.push((r) => vals.includes(r[col]));
      return b;
    },
    gte(col: string, val: string) {
      filtros.push((r) => String(r[col]) >= val);
      return b;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orden = { col, asc: opts?.ascending !== false };
      return b;
    },
    limit(n: number) {
      limite = n;
      return b;
    },
    maybeSingle: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    single: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      const rows = ejecutar();
      return Promise.resolve(
        soloConteo ? { count: rows.length, data: null, error: null } : { data: rows, error: null },
      ).then(resolve, reject);
    },
  };
  return b;
}

import { POST } from "@/app/api/precalificar/route";

const ASESOR = "11111111-1111-4111-8111-111111111111";
const OTRO_ASESOR = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const INACTIVO = "44444444-4444-4444-8444-444444444444";
const LEAD_PROPIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD_AJENO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD_SIN_ASIGNAR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NSS_PROPIO = "12345678901";
const NSS_AJENO = "98765432109";

const RESPUESTA_SCRAPER = {
  califica: true,
  nss: NSS_PROPIO,
  nombre: "JUAN PEREZ",
  rfc: "PEPJ800101ABC",
  empresa: "EMPRESA SA",
  registroPatronal: "A1234567890",
  datos: { saldoSubcuenta: "120,000.00", montoCredito: "100000", capacidadCompra: "1", pagoMensual: "2" },
};

let scraper: ReturnType<typeof vi.fn>;

async function token(sub: string, secreto = process.env.CRM_JWT_SECRET as string) {
  return new SignJWT({ sub, role: "advisor" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secreto));
}

function solicitud(body: unknown, auth?: string) {
  return POST(
    new Request("http://localhost/api/precalificar", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

async function como(sub: string, body: unknown) {
  return solicitud(body, `Bearer ${await token(sub)}`);
}

function accionesDe(leadId: string) {
  return db.lead_actions.filter((a) => a.lead_id === leadId).map((a) => a.accion);
}

describe("POST /api/precalificar", () => {
  beforeEach(() => {
    db.advisors.splice(0, db.advisors.length,
      { id: ASESOR, email: "asesor@example.com", activo: true },
      { id: OTRO_ASESOR, email: "otro@example.com", activo: true },
      { id: ADMIN, email: "admin@mejoravit.com", activo: true },
      { id: INACTIVO, email: "baja@example.com", activo: false },
    );
    db.leads.splice(0, db.leads.length,
      { id: LEAD_PROPIO, advisor_id: ASESOR, nss: NSS_PROPIO, whatsapp_phone: "5218111111111", created_at: "2026-10-01" },
      { id: LEAD_AJENO, advisor_id: OTRO_ASESOR, nss: NSS_AJENO, whatsapp_phone: "5218222222222", created_at: "2026-10-01" },
      { id: LEAD_SIN_ASIGNAR, advisor_id: null, nss: "55555555555", whatsapp_phone: "5218333333333", created_at: "2026-10-01" },
    );
    db.lead_actions.splice(0, db.lead_actions.length);
    scraper = vi.fn(async () => new Response(JSON.stringify(RESPUESTA_SCRAPER), { status: 200 }));
    vi.stubGlobal("fetch", scraper);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sin token responde 401, aunque el cuerpo diga source=bot", async () => {
    expect((await solicitud({ nss: NSS_PROPIO, phoneNumber: "5218111111111", source: "bot" })).status).toBe(401);
    expect((await solicitud({ leadId: LEAD_PROPIO })).status).toBe(401);
    expect(scraper).not.toHaveBeenCalled();
  });

  it("token inválido o firmado con otro secreto responde 401", async () => {
    expect((await solicitud({ leadId: LEAD_PROPIO }, "Bearer basura")).status).toBe(401);
    expect((await solicitud({ leadId: LEAD_PROPIO }, `Bearer ${await token(ASESOR, "otro-secreto")}`)).status).toBe(401);
    expect(scraper).not.toHaveBeenCalled();
  });

  it("asesor inactivo o inexistente responde 403", async () => {
    expect((await como(INACTIVO, { leadId: LEAD_PROPIO })).status).toBe(403);
    expect((await como("99999999-9999-4999-8999-999999999999", { leadId: LEAD_PROPIO })).status).toBe(403);
    expect(scraper).not.toHaveBeenCalled();
  });

  it("asesor autorizado precalifica su lead con el NSS guardado y sin datos sensibles en la respuesta", async () => {
    const res = await como(ASESOR, { leadId: LEAD_PROPIO });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(scraper).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(scraper.mock.calls[0][1].body))).toEqual({ nss: NSS_PROPIO });
    expect(json.resultado).toMatchObject({ califica: true, nombre: "JUAN PEREZ", nss: NSS_PROPIO });
    expect(JSON.stringify(json)).not.toMatch(/PEPJ800101ABC|EMPRESA SA|A1234567890/);

    const lead = db.leads.find((l) => l.id === LEAD_PROPIO);
    expect(lead).toMatchObject({ precalificacion_status: "aprobado", monto_base: 120000, saldo_subcuenta: "120,000.00" });
    expect(accionesDe(LEAD_PROPIO)).toEqual(["precalificacion_solicitada", "precalificacion_completada"]);
  });

  it("rechaza operar sobre un lead ajeno, también para el admin con leads asignados", async () => {
    expect((await como(ASESOR, { leadId: LEAD_AJENO })).status).toBe(403);
    expect((await como(ADMIN, { leadId: LEAD_PROPIO })).status).toBe(403);
    expect(scraper).not.toHaveBeenCalled();
    expect(db.leads.find((l) => l.id === LEAD_AJENO)?.precalificacion_status).toBeUndefined();
  });

  it("el admin opera leads sin asignar", async () => {
    expect((await como(ADMIN, { leadId: LEAD_SIN_ASIGNAR })).status).toBe(200);
  });

  it("captura manual: no permite NSS ni teléfonos de leads ajenos ni mezclar NSS", async () => {
    expect((await como(ASESOR, { nss: NSS_AJENO })).status).toBe(403);
    expect((await como(ASESOR, { nss: "77777777777", phoneNumber: "5218222222222" })).status).toBe(403);
    expect((await como(ASESOR, { nss: "77777777777", phoneNumber: "5218111111111" })).status).toBe(409);
    expect(scraper).not.toHaveBeenCalled();
  });

  it("captura manual de un NSS nuevo crea el lead dentro del alcance del asesor", async () => {
    const res = await como(ASESOR, { nss: "77777777777", phoneNumber: "8119999999" });
    expect(res.status).toBe(200);
    const { leadId } = await res.json();
    expect(db.leads.find((l) => l.id === leadId)).toMatchObject({
      advisor_id: ASESOR,
      nss: "77777777777",
      whatsapp_phone: "8119999999",
    });
  });

  it.each([
    [{ nss: "123" }],
    [{ nss: NSS_PROPIO, phoneNumber: "abc" }],
    [{ nss: NSS_PROPIO, source: "bot" }],
    [{ leadId: "no-es-uuid" }],
    [{ leadId: LEAD_PROPIO, nss: NSS_AJENO }],
  ])("valida el cuerpo con Zod: %j → 400", async (body) => {
    expect((await como(ASESOR, body)).status).toBe(400);
    expect(scraper).not.toHaveBeenCalled();
  });

  it("evita duplicados mientras hay una consulta en curso y limita solicitudes por asesor", async () => {
    db.lead_actions.push({
      id: "x",
      lead_id: LEAD_PROPIO,
      advisor_id: ASESOR,
      accion: "precalificacion_solicitada",
      created_at: new Date().toISOString(),
    });
    expect((await como(ASESOR, { leadId: LEAD_PROPIO })).status).toBe(409);

    db.lead_actions.splice(0, db.lead_actions.length);
    for (let i = 0; i < 10; i++) {
      db.lead_actions.push({
        id: `r${i}`,
        lead_id: null,
        advisor_id: ASESOR,
        accion: "precalificacion_solicitada",
        created_at: new Date().toISOString(),
      });
    }
    expect((await como(ASESOR, { leadId: LEAD_PROPIO })).status).toBe(429);
    expect(scraper).not.toHaveBeenCalled();
  });

  it("si el scraper falla responde 502, libera el lead para reintentar y no registra el NSS", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => {});
    scraper.mockResolvedValueOnce(new Response("{}", { status: 500 }));

    expect((await como(ASESOR, { leadId: LEAD_PROPIO })).status).toBe(502);
    expect(db.leads.find((l) => l.id === LEAD_PROPIO)?.precalificacion_status).toBeUndefined();
    expect(JSON.stringify(errores.mock.calls)).not.toContain(NSS_PROPIO);

    expect((await como(ASESOR, { leadId: LEAD_PROPIO })).status).toBe(200);
  });
});
