import { MX_TZ } from "@/lib/crmAgendaBuckets";

export function formatearHoraAgenda(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-MX", {
    timeZone: MX_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatearDiaCompleto(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const raw = d.toLocaleDateString("es-MX", {
    timeZone: MX_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatearDiaCortoAgenda(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const raw = d.toLocaleDateString("es-MX", {
    timeZone: MX_TZ,
    weekday: "long",
    day: "numeric",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

export function formatearTiempoRelativo(iso: string, ahora: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const diffMs = d.getTime() - ahora.getTime();
  const absMs = Math.abs(diffMs);
  const futuro = diffMs > 0;

  if (absMs < MS_HOUR) {
    const mins = Math.max(1, Math.round(absMs / MS_MIN));
    return futuro ? `en ${mins} min` : `hace ${mins} min`;
  }

  if (absMs < MS_DAY) {
    const hours = Math.max(1, Math.round(absMs / MS_HOUR));
    return futuro
      ? `en ${hours} hora${hours === 1 ? "" : "s"}`
      : `hace ${hours} hora${hours === 1 ? "" : "s"}`;
  }

  const days = Math.max(1, Math.round(absMs / MS_DAY));
  if (days === 1) {
    return futuro ? "mañana" : "ayer";
  }

  return futuro
    ? `en ${days} días`
    : `hace ${days} días`;
}

export function formatearVencidoConHora(iso: string, ahora: Date): string {
  const rel = formatearTiempoRelativo(iso, ahora);
  if (rel === "ayer") {
    return `ayer ${formatearHoraAgenda(iso)}`;
  }
  if (rel.startsWith("hace")) {
    return rel;
  }
  return `vencido · ${formatearHoraAgenda(iso)}`;
}
