"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACCEPT_ARCHIVOS_CHAT, useLeadChat } from "./useLeadChat";
import { telLead } from "@/lib/crmLeadEstadoActions";
import {
  esGeneradoresLead,
  esMejoravitLead,
  parsearNotaGenerador,
  urlWhatsAppLead,
  valorGeneradorDisplay,
} from "@/lib/parseNotaGenerador";
import {
  datetimeLocalToIso,
  isoToDatetimeLocal,
} from "@/lib/crmFechaContacto";

type LeadEstado = "nuevo" | "contactado" | "no_interesado";

type Lead = {
  id: string;
  whatsapp_phone: string;
  nss: string | null;
  horario: string | null;
  estado: LeadEstado;
  created_at: string;
  updated_at: string;
  precalificacion_status: "aprobado" | "rechazado" | "pendiente" | null;
  precalificacion_resultado: unknown;
  precalificado_at: string | null;
  nombre_infonavit: string | null;
  saldo_subcuenta: number | string | null;
  monto_base: number | string | null;
  monto_aprobado_min: number | string | null;
  monto_aprobado_max: number | string | null;
  capacidad_compra: number | string | null;
  pago_mensual: number | string | null;
  producto?: string | null;
  nota?: string | null;
  fecha_contacto?: string | null;
};

type ResultadoPrecalificacionGuardado = {
  mensaje?: string;
  datos?: {
    saldoSubcuenta?: number | string;
  };
};

function normalizarNumero(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value !== "string") return 0;
  const limpio = value.replace(/[^0-9.]/g, "");
  const num = Number(limpio);
  return Number.isFinite(num) ? num : 0;
}

function formatearMoneda(value: number): string {
  return `$${Math.floor(value).toLocaleString("es-MX")}`;
}

function estadoBadge(estado: LeadEstado): string {
  if (estado === "contactado") {
    return "bg-slate-100 text-slate-600 ring-slate-200";
  }
  if (estado === "no_interesado") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }
  return "bg-[#25D366]/15 text-[#128C7E] ring-[#25D366]/30";
}

function etiquetaEstado(estado: LeadEstado): string {
  if (estado === "contactado") return "Contactado";
  if (estado === "no_interesado") return "No interesado";
  return "Nuevo";
}

function formatearTelefonoDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("52")) {
    return `+52 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

function iconoProducto(producto?: string | null): string {
  if (producto === "generadores") return "⚡";
  if (producto === "paneles") return "☀️";
  return "🏠";
}

type VistaLead = "chat" | "estado" | "datos";

function parseVistaLead(valor: string | null): VistaLead {
  if (valor === "estado" || valor === "datos") return valor;
  return "chat";
}

export default function CrmLeadDetallePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const leadId = params.id;

  const [lead, setLead] = useState<Lead | null>(null);
  const [nota, setNota] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [precalificando, setPrecalificando] = useState(false);
  const [precalificacionError, setPrecalificacionError] = useState("");
  const [precalificacionOk, setPrecalificacionOk] = useState("");
  const [fechaContactoInput, setFechaContactoInput] = useState("");
  const [guardandoFecha, setGuardandoFecha] = useState(false);
  const [fechaOkMsg, setFechaOkMsg] = useState("");
  const [fechaErrorMsg, setFechaErrorMsg] = useState("");
  const [vistaActiva, setVistaActiva] = useState<VistaLead>(() => {
    if (typeof window === "undefined") return "chat";
    return parseVistaLead(new URLSearchParams(window.location.search).get("vista"));
  });
  const refreshLeadRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const {
    mensajes,
    chatLoading,
    chatError,
    nuevoMensaje,
    setNuevoMensaje,
    enviando,
    enviandoArchivo,
    nombreArchivoPendiente,
    enviarMensaje,
    abrirSelectorArchivo,
    onArchivoSeleccionado,
    fileInputRef,
    obtenerOrigenMensaje,
    chatContainerRef,
    chatEndRef,
    onChatScroll,
    scrollChatAlFinal,
    fetchMensajes,
  } = useLeadChat(leadId, {
    onEnvioExitoso: () => refreshLeadRef.current?.(),
  });

  function getToken(): string | null {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return null;
    }
    return token;
  }

  async function fetchLead() {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      if (res.status === 404) {
        setErrorMsg("Lead no encontrado.");
        return;
      }

      if (!res.ok) {
        setErrorMsg("No se pudo cargar el lead.");
        return;
      }

      const data = (await res.json()) as Lead;
      setLead(data);
      setFechaContactoInput(
        data.fecha_contacto ? isoToDatetimeLocal(data.fecha_contacto) : "",
      );
    } catch {
      setErrorMsg("Error de red al cargar el lead.");
    } finally {
      setLoading(false);
    }
  }
  refreshLeadRef.current = fetchLead;

  async function actualizarEstado(estado: "contactado" | "no_interesado") {
    const token = getToken();
    if (!token) return;

    setSaving(true);
    setErrorMsg("");
    setOkMsg("");

    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          estado,
          nota: nota.trim() ? nota.trim() : undefined,
        }),
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(err.error || "No se pudo actualizar el lead.");
        return;
      }

      const updated = (await res.json()) as Lead;
      setLead(updated);
      setOkMsg("Lead actualizado correctamente.");
      await fetchMensajes();
    } catch {
      setErrorMsg("Error de red al actualizar.");
    } finally {
      setSaving(false);
    }
  }

  async function guardarFechaContacto() {
    const token = getToken();
    if (!token) return;

    const iso = datetimeLocalToIso(fechaContactoInput);
    if (!iso) {
      setFechaErrorMsg("Elige una fecha y hora válidas.");
      setFechaOkMsg("");
      return;
    }

    setGuardandoFecha(true);
    setFechaErrorMsg("");
    setFechaOkMsg("");

    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fecha_contacto: iso }),
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setFechaErrorMsg(err.error || "No se pudo guardar la fecha.");
        return;
      }

      const updated = (await res.json()) as Lead;
      setLead(updated);
      setFechaContactoInput(
        updated.fecha_contacto
          ? isoToDatetimeLocal(updated.fecha_contacto)
          : "",
      );
      setFechaOkMsg("Fecha de contacto guardada.");
    } catch {
      setFechaErrorMsg("Error de red al guardar la fecha.");
    } finally {
      setGuardandoFecha(false);
    }
  }

  async function quitarFechaContacto() {
    const token = getToken();
    if (!token) return;

    setGuardandoFecha(true);
    setFechaErrorMsg("");
    setFechaOkMsg("");

    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fecha_contacto: null }),
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setFechaErrorMsg(err.error || "No se pudo quitar la fecha.");
        return;
      }

      const updated = (await res.json()) as Lead;
      setLead(updated);
      setFechaContactoInput("");
      setFechaOkMsg("Fecha de contacto eliminada.");
    } catch {
      setFechaErrorMsg("Error de red al quitar la fecha.");
    } finally {
      setGuardandoFecha(false);
    }
  }

  async function precalificarLead() {
    if (!lead?.nss) {
      setPrecalificacionError("Este lead no tiene NSS capturado.");
      return;
    }

    setPrecalificando(true);
    setPrecalificacionError("");
    setPrecalificacionOk("");

    try {
      const res = await fetch("/api/precalificar", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nss: lead.nss,
          phoneNumber: lead.whatsapp_phone,
          source: "crm",
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setPrecalificacionError(err.error || "No se pudo completar la precalificación.");
        return;
      }

      await fetchLead();
      setPrecalificacionOk("Precalificación actualizada correctamente.");
    } catch {
      setPrecalificacionError("Error de red al consultar Infonavit.");
    } finally {
      setPrecalificando(false);
    }
  }

  useEffect(() => {
    if (leadId) void fetchLead();
    const vista = parseVistaLead(
      new URLSearchParams(window.location.search).get("vista"),
    );
    setVistaActiva(vista);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  function cambiarVista(vista: VistaLead) {
    setVistaActiva(vista);
    router.replace(`/crm/leads/${leadId}?vista=${vista}`, { scroll: false });
    if (vista === "chat") {
      requestAnimationFrame(() => scrollChatAlFinal("auto"));
    }
  }

  const chatHabilitado =
    lead?.estado === "nuevo" ||
    lead?.estado === "contactado" ||
    lead?.estado === "no_interesado";

  const puedePrecalificar =
    !!lead?.nss &&
    (lead.precalificacion_status === null ||
      lead.precalificacion_status === "pendiente" ||
      lead.precalificacion_status === "rechazado" ||
      lead.precalificacion_status === "aprobado");

  const resultadoGuardado: ResultadoPrecalificacionGuardado | null =
    lead?.precalificacion_resultado &&
    typeof lead.precalificacion_resultado === "object"
      ? (lead.precalificacion_resultado as ResultadoPrecalificacionGuardado)
      : null;

  const tieneSaldoSubcuenta =
    lead?.saldo_subcuenta != null && normalizarNumero(lead.saldo_subcuenta) > 0;

  const saldoSubcuentaValor = tieneSaldoSubcuenta
    ? normalizarNumero(lead.saldo_subcuenta)
    : normalizarNumero(resultadoGuardado?.datos?.saldoSubcuenta);
  const montoMinValor = tieneSaldoSubcuenta
    ? normalizarNumero(lead.monto_aprobado_min) ||
      Math.floor(saldoSubcuentaValor * 0.9 * 0.8)
    : 0;
  const montoMaxValor = tieneSaldoSubcuenta
    ? normalizarNumero(lead.monto_aprobado_max) ||
      Math.floor((saldoSubcuentaValor * 0.9) / 0.85)
    : 0;

  const mostrarMejoravit = lead ? esMejoravitLead(lead.producto) : false;
  const mostrarGeneradores = lead ? esGeneradoresLead(lead.producto) : false;
  const datosGenerador = mostrarGeneradores
    ? parsearNotaGenerador(lead?.nota)
    : null;
  const horarioDisplay =
    lead?.horario?.trim() ? lead.horario.trim() : "Sin dato";

  const productoVolver = useMemo(() => {
    const p = lead?.producto;
    if (p === "mejoravit" || p === "paneles" || p === "generadores") return p;
    return "generadores";
  }, [lead?.producto]);

  const seccionEstado = lead ? (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Estado del lead
      </h2>
      {lead.estado === "nuevo" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void actualizarEstado("contactado")}
            className="rounded-xl bg-[#25D366] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#20bd5a] disabled:opacity-60"
          >
            {saving ? "…" : "✓ Contactado"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void actualizarEstado("no_interesado")}
            className="rounded-xl bg-slate-700 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "…" : "✕ No interesado"}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          Marcado como{" "}
          <span className="font-semibold text-slate-800">
            {etiquetaEstado(lead.estado)}
          </span>
        </p>
      )}
      <textarea
        id="nota"
        rows={2}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota opcional al cambiar estado…"
        className="mt-3 w-full resize-none rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#25D366]/50"
      />
      {errorMsg ? <p className="mt-2 text-sm text-red-600">{errorMsg}</p> : null}
      {okMsg ? <p className="mt-2 text-sm text-emerald-600">{okMsg}</p> : null}
    </section>
  ) : null;

  return (
    <main className="flex min-h-screen flex-col bg-[#e9edef]">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col shadow-[0_0_32px_rgba(0,0,0,0.06)]">
        {loading ? (
          <div className="flex flex-1 flex-col">
            <div className="h-16 animate-pulse bg-[#075E54]/80" />
            <div className="flex-1 space-y-3 p-4">
              <div className="h-28 animate-pulse rounded-2xl bg-white" />
              <div className="h-40 animate-pulse rounded-2xl bg-white" />
              <div className="h-32 animate-pulse rounded-2xl bg-white" />
            </div>
          </div>
        ) : errorMsg && !lead ? (
          <section className="m-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">
            {errorMsg}
          </section>
        ) : lead ? (
          <>
            {/* Header fijo */}
            <header className="shrink-0 bg-[#075E54] text-white">
              <div className="flex items-center gap-2 px-3 py-3">
                <button
                  type="button"
                  onClick={() =>
                    router.push(`/crm/leads?producto=${productoVolver}`)
                  }
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10"
                  aria-label="Volver a la bandeja"
                  title="Volver a todos los leads"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M15 6l-6 6 6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg ring-2 ring-white/20">
                  {iconoProducto(lead.producto)}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold leading-tight">
                    {formatearTelefonoDisplay(lead.whatsapp_phone)}
                  </p>
                  <span
                    className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${estadoBadge(
                      lead.estado,
                    )}`}
                  >
                    {etiquetaEstado(lead.estado)}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <a
                    href={urlWhatsAppLead(lead.whatsapp_phone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="WhatsApp"
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[#25D366] transition hover:bg-white/10"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm4.47-6.05c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.66.8-.81.96-.15.17-.3.19-.55.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.57-1.37-.78-1.88-.2-.49-.41-.42-.57-.43h-.49c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29Z" />
                    </svg>
                  </a>
                  <a
                    href={telLead(lead.whatsapp_phone)}
                    title="Llamar"
                    className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/10"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M6.5 4h3l1.5 5-2 1.2a11 11 0 0 0 4.8 4.8L17 14l5 1.5v3a2 2 0 0 1-2.1 2 16 16 0 0 1-13.4-7.5A2 2 0 0 1 6.5 4Z"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Tabs Chat / Estado / Datos */}
              <div className="flex gap-1 px-3 pb-3">
                <button
                  type="button"
                  onClick={() => cambiarVista("chat")}
                  className={
                    vistaActiva === "chat"
                      ? "flex flex-1 items-center justify-center gap-1 rounded-lg bg-white py-2 text-xs font-semibold text-[#075E54] shadow-sm sm:text-sm"
                      : "flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 sm:text-sm"
                  }
                >
                  Chat
                  {mensajes.length > 0 ? (
                    <span className="rounded-full bg-[#25D366] px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {mensajes.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => cambiarVista("estado")}
                  className={
                    vistaActiva === "estado"
                      ? "flex flex-1 items-center justify-center gap-1 rounded-lg bg-white py-2 text-xs font-semibold text-[#075E54] shadow-sm sm:text-sm"
                      : "flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 sm:text-sm"
                  }
                >
                  Estado
                  {lead.estado === "nuevo" ? (
                    <span className="h-2 w-2 rounded-full bg-[#25D366]" aria-hidden />
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => cambiarVista("datos")}
                  className={
                    vistaActiva === "datos"
                      ? "flex flex-1 items-center justify-center gap-1 rounded-lg bg-white py-2 text-xs font-semibold text-[#075E54] shadow-sm sm:text-sm"
                      : "flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 sm:text-sm"
                  }
                >
                  Datos
                </button>
              </div>
            </header>

            {vistaActiva === "estado" ? (
              <div className="flex-1 overflow-y-auto bg-[#f0f2f5] px-3 py-4 pb-8">
                {seccionEstado}
                <button
                  type="button"
                  onClick={() => cambiarVista("chat")}
                  className="mt-4 w-full rounded-xl py-2.5 text-center text-sm font-medium text-[#128C7E] ring-1 ring-[#128C7E]/30 hover:bg-emerald-50"
                >
                  ← Volver al chat
                </button>
              </div>
            ) : vistaActiva === "datos" ? (
              <div className="flex-1 overflow-y-auto bg-[#f0f2f5] px-3 py-4 pb-8">
                <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-emerald-200/60">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-sm font-semibold text-[#075E54]">
                      Agendar contacto 📅
                    </h2>
                    {lead.fecha_contacto ? (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200">
                        Programado
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600">
                    Cliente pidió:{" "}
                    <span className="font-medium text-slate-800">{horarioDisplay}</span>
                  </p>
                  <input
                    id="fecha_contacto"
                    type="datetime-local"
                    value={fechaContactoInput}
                    onChange={(e) => setFechaContactoInput(e.target.value)}
                    disabled={guardandoFecha}
                    className="mt-3 w-full rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-sm outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#25D366]/50 disabled:opacity-60"
                  />
                  {lead.fecha_contacto ? (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Guardado:{" "}
                      {new Date(lead.fecha_contacto).toLocaleString("es-MX", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void guardarFechaContacto()}
                      disabled={guardandoFecha || !fechaContactoInput}
                      className="flex-1 rounded-xl bg-[#075E54] py-2.5 text-sm font-medium text-white hover:bg-[#064e46] disabled:opacity-60"
                    >
                      {guardandoFecha ? "Guardando…" : "Guardar fecha"}
                    </button>
                    {lead.fecha_contacto ? (
                      <button
                        type="button"
                        onClick={() => void quitarFechaContacto()}
                        disabled={guardandoFecha}
                        className="rounded-xl px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Quitar
                      </button>
                    ) : null}
                  </div>
                  {fechaErrorMsg ? (
                    <p className="mt-2 text-xs text-red-600">{fechaErrorMsg}</p>
                  ) : null}
                  {fechaOkMsg ? (
                    <p className="mt-2 text-xs text-emerald-700">{fechaOkMsg}</p>
                  ) : null}
                </section>

                {/* Datos del producto */}
                {mostrarGeneradores ? (
                  <section className="mt-3 rounded-2xl bg-gradient-to-br from-amber-50 to-white p-4 shadow-sm ring-1 ring-amber-200/70">
                    <h2 className="text-sm font-semibold text-amber-900">
                      Generador ⚡
                    </h2>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">Horario</dt>
                        <dd className="text-right font-medium text-slate-800">
                          {horarioDisplay}
                        </dd>
                      </div>
                      {datosGenerador?.tipo === "parseado" ? (
                        <>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Uso</dt>
                            <dd className="text-right font-medium text-slate-800">
                              {valorGeneradorDisplay(datosGenerador.uso)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Equipos</dt>
                            <dd className="text-right font-medium text-slate-800">
                              {valorGeneradorDisplay(datosGenerador.equipos)}
                            </dd>
                          </div>
                        </>
                      ) : datosGenerador?.tipo === "cruda" ? (
                        <div>
                          <dt className="text-slate-500">Nota</dt>
                          <dd className="mt-1 text-slate-800">{datosGenerador.nota}</dd>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Sin calificación del bot todavía.
                        </p>
                      )}
                    </dl>
                  </section>
                ) : null}

                {mostrarMejoravit ? (
                  <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-800">
                        Infonavit 🏠
                      </h2>
                      {!tieneSaldoSubcuenta && puedePrecalificar ? (
                        <button
                          type="button"
                          onClick={() => void precalificarLead()}
                          disabled={precalificando}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {precalificando ? "Consultando…" : "Precalificar"}
                        </button>
                      ) : null}
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-slate-500">NSS</dt>
                        <dd className="font-mono font-medium text-slate-800">
                          {lead.nss ?? "—"}
                        </dd>
                      </div>
                      {tieneSaldoSubcuenta ? (
                        <>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Saldo subcuenta</dt>
                            <dd className="font-semibold text-emerald-700">
                              {formatearMoneda(saldoSubcuentaValor)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-slate-500">Rango aprobado</dt>
                            <dd className="text-right font-medium text-slate-800">
                              {formatearMoneda(montoMinValor)} –{" "}
                              {formatearMoneda(montoMaxValor)}
                            </dd>
                          </div>
                        </>
                      ) : null}
                    </dl>
                    {lead.precalificacion_status === "aprobado" ? (
                      <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
                        ✅ Aprobado · {lead.nombre_infonavit ?? "Sin titular"}
                      </div>
                    ) : null}
                    {lead.precalificacion_status === "rechazado" ? (
                      <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-200">
                        ❌ No califica · {resultadoGuardado?.mensaje ?? "Sin motivo"}
                      </div>
                    ) : null}
                    {precalificacionError ? (
                      <p className="mt-2 text-xs text-red-600">{precalificacionError}</p>
                    ) : null}
                    {precalificacionOk ? (
                      <p className="mt-2 text-xs text-emerald-600">{precalificacionOk}</p>
                    ) : null}
                  </section>
                ) : null}

                {/* Meta */}
                <section className="mt-3 rounded-2xl bg-white/80 p-4 text-xs text-slate-500 ring-1 ring-slate-200/50">
                  <div className="flex justify-between">
                    <span>Alta</span>
                    <span>
                      {new Date(lead.created_at).toLocaleDateString("es-MX", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>Actualizado</span>
                    <span>
                      {new Date(lead.updated_at).toLocaleString("es-MX", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </section>

              </div>
            ) : (
              /* Vista Chat — scroll solo dentro del contenedor */
              <div className="flex min-h-0 flex-1 flex-col bg-[#ECE5DD]">
                {!chatHabilitado ? (
                  <p className="px-4 py-3 text-sm text-slate-600">
                    El chat no está disponible para este estado.
                  </p>
                ) : null}

                <div
                  ref={chatContainerRef}
                  onScroll={onChatScroll}
                  className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
                >
                  {chatLoading && mensajes.length === 0 ? (
                    <div className="space-y-2">
                      <div className="h-10 w-2/3 animate-pulse rounded-lg bg-white/70" />
                      <div className="ml-auto h-10 w-1/2 animate-pulse rounded-lg bg-white/70" />
                    </div>
                  ) : mensajes.length === 0 ? (
                    <p className="py-12 text-center text-sm text-slate-500">
                      Sin mensajes. Escribe el primero abajo.
                    </p>
                  ) : (
                    mensajes.map((msg) => {
                      const esSaliente = msg.direccion === "saliente";
                      const origen = obtenerOrigenMensaje(msg);
                      return (
                        <div
                          key={msg.id}
                          className={`mb-2 flex ${esSaliente ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`relative max-w-[85%] rounded-lg px-3 py-2.5 text-sm shadow-sm ${
                              esSaliente
                                ? "rounded-br-[4px] bg-[#DCF8C6] text-slate-900"
                                : "rounded-bl-[4px] bg-white text-slate-900"
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words pr-8">
                              {msg.contenido}
                            </p>
                            <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-slate-500">
                              <span className="uppercase tracking-wide">{origen}</span>
                              <span>
                                {new Date(msg.created_at).toLocaleTimeString("es-MX", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {chatError ? (
                  <p className="shrink-0 border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
                    {chatError}
                  </p>
                ) : null}

                {enviandoArchivo ? (
                  <p className="shrink-0 border-t border-slate-200/80 bg-white px-4 py-2 text-xs text-slate-600">
                    Enviando archivo…
                    {nombreArchivoPendiente ? ` ${nombreArchivoPendiente}` : ""}
                  </p>
                ) : null}

                <form
                  onSubmit={(e) => e.preventDefault()}
                  className="flex shrink-0 items-end gap-2 border-t border-slate-200/80 bg-[#f0f2f5] px-3 py-2.5"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_ARCHIVOS_CHAT}
                    className="hidden"
                    onChange={onArchivoSeleccionado}
                  />
                  <button
                    type="button"
                    onClick={abrirSelectorArchivo}
                    disabled={!chatHabilitado || enviando || enviandoArchivo}
                    aria-label="Adjuntar archivo"
                    title="Adjuntar imagen, PDF o documento (máx 4 MB)"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-lg text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                  >
                    📎
                  </button>
                  <textarea
                    rows={1}
                    value={nuevoMensaje}
                    onChange={(e) => setNuevoMensaje(e.target.value)}
                    disabled={!chatHabilitado || enviando || enviandoArchivo}
                    placeholder="Mensaje de WhatsApp…"
                    className="max-h-28 min-h-[42px] flex-1 resize-none overflow-y-auto rounded-2xl border-0 bg-white px-4 py-2.5 text-sm shadow-sm outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-[#25D366]/50 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => void enviarMensaje()}
                    disabled={
                      !chatHabilitado ||
                      enviando ||
                      enviandoArchivo ||
                      !nuevoMensaje.trim()
                    }
                    aria-label="Enviar"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-lg text-white shadow-sm hover:bg-[#20bd5a] disabled:opacity-50"
                  >
                    {enviando ? "…" : "➤"}
                  </button>
                </form>
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
