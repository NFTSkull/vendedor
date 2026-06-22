"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  etiquetaEstadoUndo,
  patchLeadEstado,
  telLead,
  type CrmLeadEstado,
} from "@/lib/crmLeadEstadoActions";
import { urlWhatsAppLead } from "@/lib/parseNotaGenerador";
import {
  formatearMoneda,
  motivoRechazoLegible,
  normalizarNumero,
  nssSoloDigitos,
  nssValido,
  type ResultadoPrecalificacionApi,
} from "@/lib/precalificacionDisplay";

type LeadEstado = CrmLeadEstado;

const TABS = [
  { id: "generadores", label: "Generadores", icon: "⚡", accent: "amber" },
  { id: "mejoravit", label: "Mejoravit", icon: "🏠", accent: "emerald" },
  { id: "paneles", label: "Paneles", icon: "☀️", accent: "sky" },
] as const;

type FiltroEstado = "todos" | LeadEstado;

const FILTROS_ESTADO: { id: FiltroEstado; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "nuevo", label: "Nuevos" },
  { id: "contactado", label: "Contactados" },
  { id: "no_interesado", label: "No interesados" },
];

const TITULOS_TAB: Record<string, string> = {
  mejoravit: "Leads Mejoravit",
  paneles: "Leads Paneles Solares",
  generadores: "Leads Generadores",
};

type Lead = {
  id: string;
  whatsapp_phone: string;
  nss: string | null;
  horario: string;
  estado: LeadEstado;
  producto?: string;
  created_at: string;
  ultimo_mensaje: string | null;
  ultimo_mensaje_fecha: string | null;
  ultimo_mensaje_direccion: "entrante" | "saliente" | null;
  ultima_actividad_at: string;
};

function indicadorEstadoClase(estado: LeadEstado): string {
  if (estado === "nuevo") return "bg-[#25D366] shadow-[0_0_0_2px_rgba(37,211,102,0.35)]";
  if (estado === "contactado") return "bg-slate-400";
  return "bg-rose-400";
}

function etiquetaEstado(estado: LeadEstado): string {
  if (estado === "nuevo") return "Nuevo";
  if (estado === "contactado") return "Contactado";
  return "No interesado";
}

function claseBadgeEstado(estado: LeadEstado): string {
  if (estado === "nuevo") return "bg-[#25D366]/15 text-[#128C7E] ring-[#25D366]/25";
  if (estado === "contactado") return "bg-slate-100 text-slate-600 ring-slate-200";
  return "bg-rose-50 text-rose-700 ring-rose-200";
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

function avatarLead(lead: Lead): { label: string; bg: string; ring: string } {
  if (lead.producto === "generadores") {
    return {
      label: "⚡",
      bg: "bg-gradient-to-br from-amber-100 to-amber-200 text-amber-800",
      ring: "ring-amber-200/80",
    };
  }
  if (lead.producto === "paneles") {
    return {
      label: "☀️",
      bg: "bg-gradient-to-br from-sky-100 to-sky-200 text-sky-800",
      ring: "ring-sky-200/80",
    };
  }
  const digits = lead.whatsapp_phone.replace(/\D/g, "");
  const inicial =
    digits.charAt(digits.length - 1) ||
    lead.whatsapp_phone.charAt(0).toUpperCase() ||
    "?";
  return {
    label: inicial,
    bg: "bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-800",
    ring: "ring-emerald-200/80",
  };
}

function formatearHoraBandeja(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfMessage = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (startOfMessage.getTime() === startOfToday.getTime()) {
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }
  if (startOfMessage.getTime() === startOfYesterday.getTime()) {
    return "Ayer";
  }
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit" });
}

function horaFilaLead(lead: Lead): string {
  return formatearHoraBandeja(lead.ultima_actividad_at ?? lead.ultimo_mensaje_fecha ?? lead.created_at);
}

function previewFilaLead(lead: Lead): { texto: string; vacio: boolean } {
  if (lead.ultimo_mensaje?.trim()) {
    const prefix = lead.ultimo_mensaje_direccion === "saliente" ? "Tú: " : "";
    return { texto: prefix + lead.ultimo_mensaje.trim(), vacio: false };
  }
  if (lead.horario?.trim()) {
    return { texto: lead.horario.trim(), vacio: false };
  }
  return { texto: "Sin mensajes", vacio: true };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function IconoBuscar({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16.2 16.2 21 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconoWhatsApp({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2Zm0 18.08h-.01a8.1 8.1 0 0 1-4.12-1.12l-.3-.18-3.11.82.83-3.03-.19-.31a8.07 8.07 0 0 1-1.24-4.32c0-4.46 3.63-8.09 8.09-8.09s8.09 3.63 8.09 8.09-3.63 8.09-8.05 8.09Zm4.47-6.05c-.25-.12-1.47-.72-1.7-.8-.23-.08-.4-.12-.57.12-.17.25-.66.8-.81.96-.15.17-.3.19-.55.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.57-1.37-.78-1.88-.2-.49-.41-.42-.57-.43h-.49c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}

function IconoTelefono({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 4h3l1.5 5-2 1.2a11 11 0 0 0 4.8 4.8L17 14l5 1.5v3a2 2 0 0 1-2.1 2 16 16 0 0 1-13.4-7.5A2 2 0 0 1 6.5 4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconoRecargar({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 4v6h-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CrmLeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [tabActiva, setTabActiva] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const producto = new URLSearchParams(window.location.search).get("producto");
      if (producto && TABS.some((t) => t.id === producto)) return producto;
    }
    return "generadores";
  });
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  const [recargando, setRecargando] = useState(false);
  const [agendaUrgentes, setAgendaUrgentes] = useState(0);
  const [agendaTieneVencidos, setAgendaTieneVencidos] = useState(false);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [nssInput, setNssInput] = useState("");
  const [telefonoInput, setTelefonoInput] = useState("");
  const [precalificando, setPrecalificando] = useState(false);
  const [precalifError, setPrecalifError] = useState("");
  const [resultado, setResultado] = useState<ResultadoPrecalificacionApi | null>(
    null,
  );
  const [activandoPush, setActivandoPush] = useState(false);
  const [pushMsg, setPushMsg] = useState("");

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [actionAviso, setActionAviso] = useState("");
  const [undoBar, setUndoBar] = useState<{
    leadId: string;
    previousEstado: LeadEstado;
    nuevoEstado: LeadEstado;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpiarUndoTimer = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const mostrarActionAviso = useCallback((msg: string) => {
    setActionAviso(msg);
    window.setTimeout(() => setActionAviso(""), 4000);
  }, []);

  const programarCierreUndoBar = useCallback(() => {
    limpiarUndoTimer();
    undoTimerRef.current = setTimeout(() => {
      setUndoBar(null);
      undoTimerRef.current = null;
    }, 5000);
  }, [limpiarUndoTimer]);

  useEffect(() => {
    if (!openMenuId) return;
    function cerrarSiFuera(e: MouseEvent | TouchEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-lead-menu-root]")) return;
      setOpenMenuId(null);
    }
    document.addEventListener("mousedown", cerrarSiFuera);
    document.addEventListener("touchstart", cerrarSiFuera);
    return () => {
      document.removeEventListener("mousedown", cerrarSiFuera);
      document.removeEventListener("touchstart", cerrarSiFuera);
    };
  }, [openMenuId]);

  useEffect(() => {
    return () => limpiarUndoTimer();
  }, [limpiarUndoTimer]);

  async function cambiarEstadoLead(lead: Lead, nuevoEstado: LeadEstado) {
    if (lead.estado === nuevoEstado) {
      setOpenMenuId(null);
      return;
    }

    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    const previousEstado = lead.estado;
    limpiarUndoTimer();

    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, estado: nuevoEstado } : l)),
    );
    setOpenMenuId(null);
    setUndoBar({ leadId: lead.id, previousEstado, nuevoEstado });
    programarCierreUndoBar();

    const ok = await patchLeadEstado(lead.id, nuevoEstado, token);
    if (!ok) {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, estado: previousEstado } : l,
        ),
      );
      setUndoBar(null);
      limpiarUndoTimer();
      mostrarActionAviso("No se pudo actualizar el lead.");
    }
  }

  async function deshacerCambioEstado() {
    if (!undoBar) return;

    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    const { leadId, previousEstado, nuevoEstado } = undoBar;
    limpiarUndoTimer();
    setUndoBar(null);

    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, estado: previousEstado } : l)),
    );

    const ok = await patchLeadEstado(leadId, previousEstado, token);
    if (!ok) {
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, estado: nuevoEstado } : l)),
      );
      mostrarActionAviso("No se pudo deshacer el cambio.");
    }
  }

  function toggleMenuLead(e: ReactMouseEvent, leadId: string) {
    e.preventDefault();
    e.stopPropagation();
    setOpenMenuId((prev) => (prev === leadId ? null : leadId));
  }

  const nuevosCount = useMemo(
    () => leads.filter((l) => l.estado === "nuevo").length,
    [leads],
  );

  const conteosEstado = useMemo(() => {
    const base = { todos: leads.length, nuevo: 0, contactado: 0, no_interesado: 0 };
    for (const l of leads) {
      base[l.estado] += 1;
    }
    return base;
  }, [leads]);

  const leadsVisibles = useMemo(() => {
    let list = leads;
    if (filtroEstado !== "todos") {
      list = list.filter((l) => l.estado === filtroEstado);
    }
    const q = busqueda.trim();
    if (!q) return list;
    const qDigits = q.replace(/\D/g, "");
    const qLower = q.toLowerCase();
    return list.filter((l) => {
      const tel = l.whatsapp_phone;
      const telDigits = tel.replace(/\D/g, "");
      return (
        tel.toLowerCase().includes(qLower) ||
        (qDigits.length > 0 && telDigits.includes(qDigits))
      );
    });
  }, [leads, busqueda, filtroEstado]);

  const saldoSubcuenta = normalizarNumero(resultado?.datos?.saldoSubcuenta);
  const esMejoravit = tabActiva === "mejoravit";

  async function cargarAgendaUrgentes() {
    const token = localStorage.getItem("crm_token");
    if (!token) return;

    try {
      const res = await fetch(`/api/crm/agenda?producto=${tabActiva}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        counts: { vencidos: number; hoy: number };
      };
      setAgendaUrgentes(data.counts.vencidos + data.counts.hoy);
      setAgendaTieneVencidos(data.counts.vencidos > 0);
    } catch {
      /* badge opcional */
    }
  }

  async function cargarLeads(opciones?: { silencioso?: boolean }) {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    if (!opciones?.silencioso) {
      setLoading(true);
    } else {
      setRecargando(true);
    }
    setErrorMsg("");

    try {
      const res = await fetch(`/api/crm/leads?producto=${tabActiva}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      if (!res.ok) {
        setErrorMsg("No se pudieron cargar los leads.");
        return;
      }

      const data = (await res.json()) as Lead[];
      setLeads(data);
    } catch {
      setErrorMsg("Error de red al consultar leads.");
    } finally {
      setLoading(false);
      setRecargando(false);
    }
  }

  function cambiarTab(tabId: string) {
    setTabActiva(tabId);
    setFiltroEstado("todos");
    setBusqueda("");
    setOpenMenuId(null);
    router.replace(`/crm/leads?producto=${tabId}`, { scroll: false });
  }

  function cerrarSesion() {
    localStorage.removeItem("crm_token");
    router.replace("/crm/login");
  }

  async function activarNotificaciones() {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushMsg("Este navegador no soporta notificaciones push.");
      return;
    }
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      setPushMsg("Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
      return;
    }

    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    setActivandoPush(true);
    setPushMsg("");
    try {
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (permission !== "granted") {
        setPushMsg("Permiso denegado para notificaciones.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        }));

      const res = await fetch("/api/crm/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!res.ok) {
        setPushMsg("No se pudo registrar la suscripción push.");
        return;
      }

      setPushMsg("Notificaciones activadas.");
    } catch {
      setPushMsg("Error activando notificaciones.");
    } finally {
      setActivandoPush(false);
    }
  }

  function abrirModalPrecalificar() {
    setModalAbierto(true);
    setPrecalifError("");
    setResultado(null);
    setNssInput("");
    setTelefonoInput("");
  }

  function cerrarModal() {
    if (precalificando) return;
    setModalAbierto(false);
  }

  async function enviarPrecalificacion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nss = nssSoloDigitos(nssInput);

    if (!nssValido(nss)) {
      setPrecalifError("Ingresa un NSS válido de 11 dígitos.");
      return;
    }

    setPrecalificando(true);
    setPrecalifError("");
    setResultado(null);

    try {
      const body: Record<string, string> = {
        nss,
        source: "crm",
      };
      const tel = telefonoInput.replace(/\D/g, "");
      if (tel.length >= 10) {
        body.phoneNumber = tel;
      }

      const res = await fetch("/api/precalificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setPrecalifError(err.error || "No se pudo completar la precalificación.");
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        resultado: ResultadoPrecalificacionApi;
      };
      setResultado(data.resultado);
      await cargarLeads();
    } catch {
      setPrecalifError("Error de red al consultar Infonavit.");
    } finally {
      setPrecalificando(false);
    }
  }

  useEffect(() => {
    void cargarLeads();
    void cargarAgendaUrgentes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabActiva]);

  const tabActual = TABS.find((t) => t.id === tabActiva);

  return (
    <main className="min-h-screen bg-[#e9edef]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col shadow-[0_0_40px_rgba(0,0,0,0.08)]">
        <div className="sticky top-0 z-30">
        {/* Header estilo WhatsApp Business */}
        <header className="bg-[#075E54] text-white">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-xl backdrop-blur-sm">
              {tabActual?.icon ?? "💬"}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {TITULOS_TAB[tabActiva] ?? "Leads"}
              </h1>
              <p className="truncate text-xs text-white/75">
                {leads.length} conversaciones · {nuevosCount} sin leer
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="Recargar bandeja"
                onClick={() => void cargarLeads({ silencioso: true })}
                disabled={loading || recargando}
                className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 disabled:opacity-50"
              >
                <IconoRecargar
                  className={`h-5 w-5 ${recargando ? "animate-spin" : ""}`}
                />
              </button>
              <button
                type="button"
                title="Activar notificaciones"
                onClick={() => void activarNotificaciones()}
                disabled={activandoPush}
                className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 disabled:opacity-50"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 17H9l-1 2h8l-1-2Zm-1-13a5 5 0 0 0-9.9 1.1A4 4 0 0 0 6 10v4l-2 2h16l-2-2v-4a4 4 0 0 0-3.1-3.9A5 5 0 0 0 14 4Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {esMejoravit ? (
                <button
                  type="button"
                  title="Precalificar NSS"
                  onClick={abrirModalPrecalificar}
                  className="hidden h-10 rounded-full bg-white/15 px-3 text-xs font-medium backdrop-blur-sm transition hover:bg-white/25 sm:inline-flex sm:items-center"
                >
                  + NSS
                </button>
              ) : null}
              <button
                type="button"
                title="Cerrar sesión"
                onClick={cerrarSesion}
                className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 17l5-5-5-5M21 12H9"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Tabs segmentados */}
          <div className="px-3 pb-3">
            <div className="flex gap-1 rounded-xl bg-[#064e46] p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => cambiarTab(tab.id)}
                  className={
                    tabActiva === tab.id
                      ? "flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-2 text-xs font-semibold text-[#075E54] shadow-sm transition"
                      : "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
                  }
                >
                  <span aria-hidden>{tab.icon}</span>
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
              <Link
                href={`/crm/agenda?producto=${tabActiva}`}
                className="relative flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                <span aria-hidden>📅</span>
                <span className="truncate">Agenda</span>
                {agendaUrgentes > 0 ? (
                  <span
                    className={
                      agendaTieneVencidos
                        ? "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
                        : "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#25D366] px-1 text-[10px] font-bold text-white"
                    }
                  >
                    {agendaUrgentes > 99 ? "99+" : agendaUrgentes}
                  </span>
                ) : null}
              </Link>
            </div>
          </div>
        </header>

        {/* Barra de búsqueda y filtros */}
        <div className="border-b border-slate-200/80 bg-[#f0f2f5] px-3 py-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <IconoBuscar className="h-4 w-4" />
            </span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar teléfono..."
              className="w-full rounded-xl border-0 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-800 shadow-sm outline-none ring-1 ring-slate-200/80 placeholder:text-slate-400 focus:ring-2 focus:ring-[#25D366]/60"
            />
            {busqueda ? (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Limpiar búsqueda"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTROS_ESTADO.map((f) => {
              const activo = filtroEstado === f.id;
              const count = conteosEstado[f.id];
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFiltroEstado(f.id)}
                  className={
                    activo
                      ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#075E54] px-3 py-1.5 text-xs font-medium text-white shadow-sm"
                      : "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200/80 transition hover:bg-slate-50"
                  }
                >
                  {f.label}
                  <span
                    className={
                      activo
                        ? "rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]"
                        : "rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                    }
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {pushMsg ? (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200/60">
              {pushMsg}
            </p>
          ) : null}
        </div>
        </div>

        {/* Lista de conversaciones */}
        <div className="flex-1 bg-white">
          {loading ? (
            <section>
              {[...Array(7)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-slate-100/80 px-4 py-3.5"
                >
                  <div className="h-[52px] w-[52px] shrink-0 rounded-full bg-gradient-to-br from-slate-200 to-slate-100 animate-pulse" />
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="flex justify-between gap-3">
                      <div className="h-4 w-2/5 rounded-md bg-slate-200 animate-pulse" />
                      <div className="h-3 w-10 rounded bg-slate-100 animate-pulse" />
                    </div>
                    <div className="h-3 w-4/5 rounded bg-slate-100 animate-pulse" />
                  </div>
                </div>
              ))}
            </section>
          ) : errorMsg ? (
            <section className="m-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
              <p className="text-sm font-medium text-red-700">{errorMsg}</p>
              <button
                type="button"
                onClick={() => void cargarLeads()}
                className="mt-3 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Reintentar
              </button>
            </section>
          ) : leadsVisibles.length === 0 ? (
            <section className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#f0f2f5] text-4xl">
                {busqueda.trim() || filtroEstado !== "todos" ? "🔍" : tabActual?.icon ?? "💬"}
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-800">
                {busqueda.trim()
                  ? "Sin resultados"
                  : filtroEstado !== "todos"
                    ? `No hay leads ${FILTROS_ESTADO.find((f) => f.id === filtroEstado)?.label.toLowerCase()}`
                    : "Bandeja vacía"}
              </h2>
              <p className="mt-1 max-w-xs text-sm text-slate-500">
                {busqueda.trim() ? (
                  <>Prueba con otro teléfono o limpia el filtro.</>
                ) : filtroEstado !== "todos" ? (
                  <button
                    type="button"
                    onClick={() => setFiltroEstado("todos")}
                    className="font-medium text-[#128C7E] hover:underline"
                  >
                    Ver todos los leads
                  </button>
                ) : esMejoravit ? (
                  <>
                    Cuando lleguen leads aparecerán aquí. También puedes{" "}
                    <button
                      type="button"
                      onClick={abrirModalPrecalificar}
                      className="font-medium text-[#128C7E] hover:underline"
                    >
                      precalificar un NSS
                    </button>
                    .
                  </>
                ) : (
                  <>Los nuevos mensajes de WhatsApp aparecerán aquí automáticamente.</>
                )}
              </p>
            </section>
          ) : (
            <section>
              {leadsVisibles.map((lead, index) => {
                const avatar = avatarLead(lead);
                const preview = previewFilaLead(lead);
                const horarioTexto = lead.horario?.trim() ?? "";
                const menuAbierto = openMenuId === lead.id;
                const esNuevo = lead.estado === "nuevo";
                return (
                  <div
                    key={lead.id}
                    className={`group relative flex items-stretch border-b border-slate-100/90 transition-colors last:border-b-0 ${
                      esNuevo ? "bg-[#f0fdf4]/40" : "bg-white"
                    } ${menuAbierto ? "z-10 bg-slate-50" : "hover:bg-[#f5f6f6]"}`}
                  >
                    {esNuevo ? (
                      <span
                        className="absolute left-0 top-0 h-full w-[3px] bg-[#25D366]"
                        aria-hidden
                      />
                    ) : null}

                    <Link
                      href={`/crm/leads/${lead.id}?vista=chat`}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-1"
                    >
                      <div className="relative shrink-0">
                        <div
                          className={`flex h-[52px] w-[52px] items-center justify-center rounded-full text-lg font-bold ring-2 ${avatar.bg} ${avatar.ring}`}
                        >
                          {avatar.label}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${indicadorEstadoClase(
                            lead.estado,
                          )}`}
                          aria-label={`Estado: ${etiquetaEstado(lead.estado)}`}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p
                              className={`truncate text-[15px] leading-tight ${
                                esNuevo
                                  ? "font-bold text-slate-900"
                                  : "font-semibold text-slate-800"
                              }`}
                            >
                              {formatearTelefonoDisplay(lead.whatsapp_phone)}
                            </p>
                            <span
                              className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${claseBadgeEstado(
                                lead.estado,
                              )}`}
                            >
                              {etiquetaEstado(lead.estado)}
                            </span>
                          </div>
                          <span
                            className={`shrink-0 pt-0.5 text-[11px] tabular-nums ${
                              esNuevo ? "font-semibold text-[#128C7E]" : "text-slate-500"
                            }`}
                          >
                            {horaFilaLead(lead)}
                          </span>
                        </div>
                        <p
                          className={`mt-1 truncate text-[13px] leading-snug ${
                            preview.vacio
                              ? "italic text-slate-400"
                              : esNuevo
                                ? "font-medium text-slate-700"
                                : "text-slate-600"
                          }`}
                        >
                          {preview.texto}
                        </p>
                        {horarioTexto ? (
                          <span className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md bg-amber-50/90 px-2 py-0.5 text-[11px] text-amber-900 ring-1 ring-amber-200/60">
                            <span aria-hidden className="shrink-0 text-[10px]">
                              📅
                            </span>
                            <span className="truncate">{horarioTexto}</span>
                          </span>
                        ) : null}
                      </div>
                    </Link>

                    <div
                      className="flex shrink-0 items-center gap-0.5 pr-2"
                      data-lead-menu-root
                    >
                      <a
                        href={urlWhatsAppLead(lead.whatsapp_phone)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Abrir WhatsApp"
                        className="flex h-9 w-9 items-center justify-center rounded-full text-[#25D366] opacity-80 transition hover:bg-[#25D366]/10 hover:opacity-100 sm:opacity-100"
                      >
                        <IconoWhatsApp className="h-[18px] w-[18px]" />
                      </a>
                      <a
                        href={telLead(lead.whatsapp_phone)}
                        onClick={(e) => e.stopPropagation()}
                        title="Llamar"
                        className="hidden h-9 w-9 items-center justify-center rounded-full text-[#128C7E] transition hover:bg-[#128C7E]/10 sm:flex"
                      >
                        <IconoTelefono className="h-[17px] w-[17px]" />
                      </a>
                      <button
                        type="button"
                        aria-label="Más acciones"
                        aria-expanded={menuAbierto}
                        onClick={(e) => toggleMenuLead(e, lead.id)}
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition ${
                          menuAbierto
                            ? "bg-slate-200 text-slate-700"
                            : "text-slate-400 hover:bg-slate-200/70 hover:text-slate-600"
                        }`}
                      >
                        ⋮
                      </button>

                      {menuAbierto ? (
                        <div
                          role="menu"
                          className={`absolute right-2 z-50 w-56 overflow-hidden rounded-2xl border border-slate-200/90 bg-white py-1.5 shadow-xl ring-1 ring-black/5 ${
                            index >= leadsVisibles.length - 2
                              ? "bottom-full mb-1"
                              : "top-full mt-1"
                          }`}
                        >
                          {lead.estado !== "contactado" ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-800 transition hover:bg-slate-50"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void cambiarEstadoLead(lead, "contactado");
                              }}
                            >
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                ✓
                              </span>
                              Marcar contactado
                            </button>
                          ) : null}
                          {lead.estado !== "no_interesado" ? (
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-800 transition hover:bg-slate-50"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void cambiarEstadoLead(lead, "no_interesado");
                              }}
                            >
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                                ✕
                              </span>
                              No interesado
                            </button>
                          ) : null}
                          <div className="my-1 border-t border-slate-100" />
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#075E54] transition hover:bg-slate-50"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setOpenMenuId(null);
                              window.location.href = telLead(lead.whatsapp_phone);
                            }}
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-[#128C7E]">
                              <IconoTelefono className="h-3.5 w-3.5" />
                            </span>
                            Llamar
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[#075E54] transition hover:bg-slate-50"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setOpenMenuId(null);
                              window.open(
                                urlWhatsAppLead(lead.whatsapp_phone),
                                "_blank",
                                "noopener,noreferrer",
                              );
                            }}
                          >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#25D366]/15 text-[#25D366]">
                              <IconoWhatsApp className="h-3.5 w-3.5" />
                            </span>
                            Abrir WhatsApp
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {/* FAB precalificar en móvil (Mejoravit) */}
        {esMejoravit && !loading ? (
          <button
            type="button"
            onClick={abrirModalPrecalificar}
            className="fixed bottom-6 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#075E54] text-2xl text-white shadow-lg shadow-[#075E54]/30 transition hover:scale-105 hover:bg-[#064e46] sm:hidden"
            title="Precalificar NSS"
          >
            +
          </button>
        ) : null}
      </div>

      {modalAbierto ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={cerrarModal}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#075E54]">
                  Precalificar Infonavit
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Consulta NSS y vincula lead automáticamente
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarModal}
                disabled={precalificando}
                className="rounded-lg border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 disabled:opacity-50"
              >
                Cerrar
              </button>
            </div>

            <form onSubmit={enviarPrecalificacion} className="mt-4 space-y-3">
              <div>
                <label htmlFor="nss" className="block text-sm font-medium mb-1">
                  Número de Seguro Social (NSS) *
                </label>
                <input
                  id="nss"
                  type="text"
                  inputMode="numeric"
                  maxLength={11}
                  value={nssInput}
                  onChange={(e) =>
                    setNssInput(e.target.value.replace(/\D/g, "").slice(0, 11))
                  }
                  disabled={precalificando}
                  placeholder="11 dígitos"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              <div>
                <label
                  htmlFor="telefono"
                  className="block text-sm font-medium mb-1"
                >
                  Teléfono WhatsApp (opcional)
                </label>
                <input
                  id="telefono"
                  type="text"
                  inputMode="tel"
                  value={telefonoInput}
                  onChange={(e) => setTelefonoInput(e.target.value)}
                  disabled={precalificando}
                  placeholder="Si ya existe lead, vincular por teléfono"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>

              {precalifError ? (
                <p className="text-sm text-red-600">{precalifError}</p>
              ) : null}

              <button
                type="submit"
                disabled={precalificando || nssInput.length !== 11}
                className="w-full rounded-xl bg-blue-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {precalificando
                  ? "Consultando Infonavit..."
                  : "Consultar precalificación"}
              </button>
              {precalificando ? (
                <p className="text-sm text-slate-600">
                  Consultando Infonavit... esto puede tardar hasta 2 minutos.
                </p>
              ) : null}
            </form>

            {resultado ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                {resultado.califica ? (
                  <>
                    <span className="inline-flex rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700">
                      ✅ Aprobado
                    </span>
                    <div className="mt-2 grid gap-1 text-slate-800">
                      <p>
                        <span className="font-medium">Titular:</span>{" "}
                        {resultado.nombre ?? "Sin dato"}
                      </p>
                      <p>
                        <span className="font-medium">Saldo subcuenta de vivienda:</span>{" "}
                        {saldoSubcuenta > 0
                          ? formatearMoneda(saldoSubcuenta)
                          : "Sin dato"}
                      </p>
                      <p>
                        <span className="font-medium">Capacidad de compra:</span>{" "}
                        {resultado.datos?.capacidadCompra
                          ? formatearMoneda(
                              normalizarNumero(resultado.datos.capacidadCompra),
                            )
                          : "Sin dato"}
                      </p>
                      <p>
                        <span className="font-medium">Pago mensual estimado:</span>{" "}
                        {resultado.datos?.pagoMensual
                          ? formatearMoneda(
                              normalizarNumero(resultado.datos.pagoMensual),
                            )
                          : "Sin dato"}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="inline-flex rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700">
                      ❌ No califica
                    </span>
                    <p className="mt-2 text-slate-800">
                      <span className="font-medium">Motivo:</span>{" "}
                      {motivoRechazoLegible(resultado.mensaje)}
                    </p>
                    <p className="mt-1 text-slate-600">
                      NSS consultado: {resultado.nss ?? nssSoloDigitos(nssInput)}
                    </p>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {undoBar ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-[#1f2c34] px-4 py-3.5 text-sm text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-sm">
            <span className="min-w-0 flex-1">
              Marcado como {etiquetaEstadoUndo(undoBar.nuevoEstado)} ·{" "}
              <button
                type="button"
                onClick={() => void deshacerCambioEstado()}
                className="font-semibold text-[#25D366] underline-offset-2 hover:underline"
              >
                Deshacer
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {actionAviso ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
          <p className="pointer-events-auto rounded-xl bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
            {actionAviso}
          </p>
        </div>
      ) : null}
    </main>
  );
}
