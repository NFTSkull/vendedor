/**
 * Doble de Supabase para pruebas: aplica los filtros sobre tablas en memoria y
 * ejecuta cada UPDATE condicionado de forma atómica, como lo haría Postgres.
 */
type Fila = Record<string, unknown>;
type Filtro = (fila: Fila) => boolean;
type Operacion = "select" | "update";

export type SupabaseEnMemoria = {
  tablas: Record<string, Fila[]>;
  operaciones: { tabla: string; op: Operacion }[];
  updates: { tabla: string; patch: Fila }[];
  alEjecutar?: (tabla: string, op: Operacion) => void;
  from: (tabla: string) => ConsultaEnMemoria;
};

function valorComparable(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const ms = Date.parse(s);
    if (!Number.isNaN(ms)) return ms;
  }
  return s;
}

function iguales(a: unknown, b: unknown): boolean {
  return valorComparable(a) === valorComparable(b);
}

function separarNivelSuperior(expr: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let actual = "";
  for (const c of expr) {
    if (c === "(") profundidad += 1;
    if (c === ")") profundidad -= 1;
    if (c === "," && profundidad === 0) {
      partes.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  if (actual) partes.push(actual);
  return partes;
}

function filtroOr(expr: string): Filtro {
  const condiciones = separarNivelSuperior(expr).map((parte): Filtro => {
    const [col, op, ...resto] = parte.split(".");
    const valor = resto.join(".");
    if (op === "is" && valor === "null") return (f) => f[col] == null;
    if (op === "not" && valor === "is.null") return (f) => f[col] != null;
    if (op === "eq") return (f) => iguales(f[col], valor);
    if (op === "in") {
      const lista = valor.replace(/^\(|\)$/g, "").split(",");
      return (f) => lista.includes(String(f[col]));
    }
    throw new Error(`Filtro or no soportado: ${parte}`);
  });
  return (f) => condiciones.some((c) => c(f));
}

export class ConsultaEnMemoria implements PromiseLike<{ data: unknown; error: null }> {
  private op: Operacion = "select";
  private patch: Fila = {};
  private devolverFilas = false;
  private filtros: Filtro[] = [];
  private orden?: { col: string; asc: boolean };
  private limite?: number;
  private unico = false;

  constructor(
    private readonly db: SupabaseEnMemoria,
    private readonly tabla: string,
  ) {}

  select(): this {
    if (this.op === "update") this.devolverFilas = true;
    return this;
  }

  update(patch: Fila): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }

  eq(col: string, valor: unknown): this {
    this.filtros.push((f) => iguales(f[col], valor));
    return this;
  }

  neq(col: string, valor: unknown): this {
    this.filtros.push((f) => !iguales(f[col], valor));
    return this;
  }

  in(col: string, valores: unknown[]): this {
    this.filtros.push((f) => valores.some((v) => iguales(f[col], v)));
    return this;
  }

  is(col: string, valor: null): this {
    void valor;
    this.filtros.push((f) => f[col] == null);
    return this;
  }

  not(col: string, operador: "is", valor: null): this {
    void operador;
    void valor;
    this.filtros.push((f) => f[col] != null);
    return this;
  }

  gte(col: string, valor: unknown): this {
    this.filtros.push((f) => {
      const a = valorComparable(f[col]);
      const b = valorComparable(valor);
      return a != null && b != null && a >= b;
    });
    return this;
  }

  gt(col: string, valor: unknown): this {
    this.filtros.push((f) => {
      const a = valorComparable(f[col]);
      const b = valorComparable(valor);
      return a != null && b != null && a > b;
    });
    return this;
  }

  or(expr: string): this {
    this.filtros.push(filtroOr(expr));
    return this;
  }

  order(col: string, opciones?: { ascending?: boolean }): this {
    this.orden = { col, asc: opciones?.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this.limite = n;
    return this;
  }

  maybeSingle(): this {
    this.unico = true;
    return this;
  }

  then<R1 = { data: unknown; error: null }, R2 = never>(
    onFulfilled?: ((v: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.ejecutar().then(onFulfilled, onRejected);
  }

  private async ejecutar(): Promise<{ data: unknown; error: null }> {
    await Promise.resolve();
    this.db.operaciones.push({ tabla: this.tabla, op: this.op });
    const resultado = this.resolver();
    this.db.alEjecutar?.(this.tabla, this.op);
    return resultado;
  }

  private resolver(): { data: unknown; error: null } {
    const filas = (this.db.tablas[this.tabla] ??= []);
    const coinciden = filas.filter((f) => this.filtros.every((fn) => fn(f)));

    if (this.op === "update") {
      for (const fila of coinciden) Object.assign(fila, this.patch);
      if (coinciden.length > 0) {
        this.db.updates.push({ tabla: this.tabla, patch: { ...this.patch } });
      }
      return {
        data: this.devolverFilas ? coinciden.map((f) => ({ ...f })) : null,
        error: null,
      };
    }

    let resultado = coinciden.map((f) => ({ ...f }));
    if (this.orden) {
      const { col, asc } = this.orden;
      resultado.sort((a, b) => {
        const va = valorComparable(a[col]) ?? 0;
        const vb = valorComparable(b[col]) ?? 0;
        if (va === vb) return 0;
        return (va < vb ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.limite != null) resultado = resultado.slice(0, this.limite);
    if (this.unico) return { data: resultado[0] ?? null, error: null };
    return { data: resultado, error: null };
  }
}

export function crearSupabaseEnMemoria(
  tablas: Record<string, Fila[]>,
): SupabaseEnMemoria {
  const db: SupabaseEnMemoria = {
    tablas,
    operaciones: [],
    updates: [],
    from: (tabla: string) => new ConsultaEnMemoria(db, tabla),
  };
  return db;
}
