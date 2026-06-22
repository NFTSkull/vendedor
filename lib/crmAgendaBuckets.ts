export const MX_TZ = "America/Mexico_City";

export type AgendaBucket =
  | "vencidos"
  | "hoy"
  | "manana"
  | "esta_semana"
  | "futuros"
  | "sin_agendar";

export type LeadAgendaInput = {
  id: string;
  whatsapp_phone: string;
  producto?: string | null;
  estado: string;
  fecha_contacto: string | null;
  fecha_contacto_origen?: string | null;
  horario?: string | null;
  nota?: string | null;
  advisor_id?: string | null;
  created_at: string;
};

export type AgendaBucketsResponse = {
  vencidos: LeadAgendaInput[];
  hoy: LeadAgendaInput[];
  manana: LeadAgendaInput[];
  esta_semana: LeadAgendaInput[];
  futuros: LeadAgendaInput[];
  sin_agendar: LeadAgendaInput[];
  counts: Record<AgendaBucket, number>;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  weekday: number;
};

function getZonedParts(date: Date, timeZone = MX_TZ): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function zonedTimeToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  sec: number,
  timeZone = MX_TZ,
): Date {
  let utc = Date.UTC(y, m - 1, d, h, min, sec);
  for (let i = 0; i < 2; i++) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const desired = Date.UTC(y, m - 1, d, h, min, sec);
    const actual = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      0,
      0,
    );
    utc += desired - actual;
  }
  return new Date(utc);
}

export function startOfZonedDay(anchor: Date, timeZone = MX_TZ): Date {
  const p = getZonedParts(anchor, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

export function endOfZonedDay(anchor: Date, timeZone = MX_TZ): Date {
  const p = getZonedParts(anchor, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 23, 59, 59, timeZone);
}

function addZonedDays(anchor: Date, days: number, timeZone = MX_TZ): Date {
  const p = getZonedParts(anchor, timeZone);
  const noon = zonedTimeToUtc(p.year, p.month, p.day, 12, 0, 0, timeZone);
  return new Date(noon.getTime() + days * 86_400_000);
}

export function endOfCurrentWeekSunday(ahora: Date, timeZone = MX_TZ): Date {
  const p = getZonedParts(ahora, timeZone);
  const daysUntilSunday = p.weekday === 0 ? 0 : 7 - p.weekday;
  const sunday = addZonedDays(ahora, daysUntilSunday, timeZone);
  return endOfZonedDay(sunday, timeZone);
}

export function clasificarLeadEnBucket(
  fecha_contacto: string | null,
  estado: string,
  ahora: Date,
): AgendaBucket | null {
  if (estado === "no_interesado") return null;

  if (!fecha_contacto) {
    if (estado === "nuevo") return "sin_agendar";
    return null;
  }

  const fc = new Date(fecha_contacto);
  if (Number.isNaN(fc.getTime())) return null;

  if (estado === "contactado" && fc.getTime() < ahora.getTime()) {
    return null;
  }

  const todayStart = startOfZonedDay(ahora);
  const todayEnd = endOfZonedDay(ahora);
  const tomorrowStart = startOfZonedDay(addZonedDays(ahora, 1));
  const tomorrowEnd = endOfZonedDay(addZonedDays(ahora, 1));
  const dayAfterTomorrowStart = startOfZonedDay(addZonedDays(ahora, 2));
  const weekSundayEnd = endOfCurrentWeekSunday(ahora);

  const ts = fc.getTime();

  if (ts < ahora.getTime() && estado !== "contactado") {
    return "vencidos";
  }

  if (ts >= todayStart.getTime() && ts <= todayEnd.getTime()) {
    return "hoy";
  }

  if (ts >= tomorrowStart.getTime() && ts <= tomorrowEnd.getTime()) {
    return "manana";
  }

  if (ts >= dayAfterTomorrowStart.getTime() && ts <= weekSundayEnd.getTime()) {
    return "esta_semana";
  }

  if (ts > weekSundayEnd.getTime()) {
    return "futuros";
  }

  return null;
}

function sortLeadsInBucket(
  bucket: AgendaBucket,
  a: LeadAgendaInput,
  b: LeadAgendaInput,
): number {
  if (bucket === "sin_agendar") {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }
  const aFc = a.fecha_contacto ? new Date(a.fecha_contacto).getTime() : 0;
  const bFc = b.fecha_contacto ? new Date(b.fecha_contacto).getTime() : 0;
  return aFc - bFc;
}

export function agruparLeadsEnAgenda(
  leads: LeadAgendaInput[],
  ahora: Date,
): AgendaBucketsResponse {
  const buckets: AgendaBucketsResponse = {
    vencidos: [],
    hoy: [],
    manana: [],
    esta_semana: [],
    futuros: [],
    sin_agendar: [],
    counts: {
      vencidos: 0,
      hoy: 0,
      manana: 0,
      esta_semana: 0,
      futuros: 0,
      sin_agendar: 0,
    },
  };

  for (const lead of leads) {
    const bucket = clasificarLeadEnBucket(lead.fecha_contacto, lead.estado, ahora);
    if (!bucket) continue;
    buckets[bucket].push(lead);
  }

  for (const key of Object.keys(buckets.counts) as AgendaBucket[]) {
    buckets[key].sort((a, b) => sortLeadsInBucket(key, a, b));
    buckets.counts[key] = buckets[key].length;
  }

  return buckets;
}

/** Clave YYYY-MM-DD en zona MX para agrupar esta_semana por día. */
export function diaMexicoKey(iso: string, timeZone = MX_TZ): string {
  const p = getZonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
