"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AgendaBucket,
  type AgendaBucketsResponse,
  type LeadAgendaInput,
  diaMexicoKey,
} from "@/lib/crmAgendaBuckets";
import {
  formatearDiaCortoAgenda,
  formatearDiaCompleto,
  formatearHoraAgenda,
  formatearTiempoRelativo,
  formatearVencidoConHora,
} from "@/lib/crmAgendaFormat";
import {
  etiquetaEstadoUndo,
  patchLeadEstado,
  telLead,
  type CrmLeadEstado,
} from "@/lib/crmLeadEstadoActions";
import { urlWhatsAppLead } from "@/lib/parseNotaGenerador";

const TABS = [
  { id: "generadores", label: "Generadores", icon: "⚡" },
  { id: "mejoravit", label: "Mejoravit", icon: "🏠" },
  { id: "paneles", label: "Paneles", icon: "☀️" },
] as const;

const TITULOS_TAB: Record<string, string> = {
  mejoravit: "Leads Mejoravit",
  paneles: "Leads Paneles Solares",
  generadores: "Leads Generadores",
};

type LeadAgenda = LeadAgendaInput;

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

function avatarLead(producto?: string | null): {
  label: string;
  bg: string;
} {
  if (producto === "generadores") {
    return { label: "⚡", bg: "bg-gradient-to-br from-amber-100 to-amber-200" };
  }
  if (producto === "paneles") {
    return { label: "☀️", bg: "bg-gradient-to-br from-sky-100 to-sky-200" };
  }
  return { label: "🏠", bg: "bg-gradient-to-br from-emerald-100 to-teal-100" };
}

function IconoRecargar({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type AgendaCardProps = {
  lead: LeadAgenda;
  ahora: Date;
  bucket: AgendaBucket;
  onMarcarContactado: (lead: LeadAgenda) => void;
};

function AgendaLeadCard({
  lead,
  ahora,
  bucket,
  onMarcarContactado,
}: AgendaCardProps) {
  const avatar = avatarLead(lead.producto);
  const telefono = formatearTelefonoDisplay(lead.whatsapp_phone);

  let linea2 = "";
  if (bucket === "vencidos" && lead.fecha_contacto) {
    linea2 = formatearVencidoConHora(lead.fecha_contacto, ahora);
  } else if (bucket === "hoy" && lead.fecha_contacto) {
    linea2 = formatearHoraAgenda(lead.fecha_contacto);
  } else if (bucket === "manana" && lead.fecha_contacto) {
    linea2 = formatearHoraAgenda(lead.fecha_contacto);
  } else if (bucket === "futuros" && lead.fecha_contacto) {
    linea2 = formatearDiaCompleto(lead.fecha_contacto);
  } else if (lead.fecha_contacto) {
    linea2 = formatearTiempoRelativo(lead.fecha_contacto, ahora);
  }

  return (
    <article className="flex gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/80">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${avatar.bg}`}
      >
        {avatar.label}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{telefono}</p>
        {linea2 ? (
          <p
            className={
              bucket === "hoy"
                ? "text-sm font-medium text-[#128C7E]"
                : "text-sm text-slate-600"
            }
          >
            {linea2}
          </p>
        ) : null}
        {lead.horario?.trim() ? (
          <p className="mt-0.5 truncate text-xs text-slate-500">{lead.horario.trim()}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <a
            href={urlWhatsAppLead(lead.whatsapp_phone)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[#25D366]/15 px-2.5 py-1 text-xs font-medium text-[#128C7E] ring-1 ring-[#25D366]/30"
          >
            WhatsApp
          </a>
          <a
            href={telLead(lead.whatsapp_phone)}
            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
          >
            Llamar
          </a>
          <Link
            href={`/crm/leads/${lead.id}?vista=chat`}
            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
          >
            Chat
          </Link>
          {lead.estado !== "contactado" ? (
            <button
              type="button"
              onClick={() => onMarcarContactado(lead)}
              className="rounded-lg bg-[#075E54]/10 px-2.5 py-1 text-xs font-medium text-[#075E54] ring-1 ring-[#075E54]/20"
            >
              Marcar contactado
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function SeccionAgenda({
  titulo,
  colorClass,
  leads,
  bucket,
  ahora,
  placeholder,
  onMarcarContactado,
  children,
}: {
  titulo: string;
  colorClass: string;
  leads: LeadAgenda[];
  bucket: AgendaBucket;
  ahora: Date;
  placeholder?: string;
  onMarcarContactado: (lead: LeadAgenda) => void;
  children?: React.ReactNode;
}) {
  if (leads.length === 0 && !children) {
    if (placeholder) {
      return (
        <section className="px-3 py-2">
          <h2 className={`mb-2 text-sm font-semibold ${colorClass}`}>{titulo} (0)</h2>
          <p className="rounded-xl bg-white/80 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200/60">
            {placeholder}
          </p>
        </section>
      );
    }
    return null;
  }

  if (leads.length === 0 && !children) return null;

  return (
    <section className="px-3 py-2">
      <h2 className={`mb-2 text-sm font-semibold ${colorClass}`}>
        {titulo} ({leads.length})
      </h2>
      <div className="space-y-2">
        {children}
        {leads.map((lead) => (
          <AgendaLeadCard
            key={lead.id}
            lead={lead}
            ahora={ahora}
            bucket={bucket}
            onMarcarContactado={onMarcarContactado}
          />
        ))}
      </div>
    </section>
  );
}

const EMPTY_AGENDA: AgendaBucketsResponse = {
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

export default function CrmAgendaPage() {
  const router = useRouter();
  const [tabActiva, setTabActiva] = useState(() => {
    if (typeof window === "undefined") return "generadores";
    return new URLSearchParams(window.location.search).get("producto") ?? "generadores";
  });
  const [agenda, setAgenda] = useState<AgendaBucketsResponse>(EMPTY_AGENDA);
  const [loading, setLoading] = useState(true);
  const [recargando, setRecargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [ahora, setAhora] = useState(() => new Date());
  const [diasExpandidos, setDiasExpandidos] = useState<Record<string, boolean>>({});
  const [undoBar, setUndoBar] = useState<{
    leadId: string;
    previousEstado: CrmLeadEstado;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpiarUndoTimer = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const programarCierreUndoBar = useCallback(() => {
    limpiarUndoTimer();
    undoTimerRef.current = setTimeout(() => {
      setUndoBar(null);
      undoTimerRef.current = null;
    }, 5000);
  }, [limpiarUndoTimer]);

  const cargarAgenda = useCallback(
    async (opciones?: { silencioso?: boolean }) => {
      const token = localStorage.getItem("crm_token");
      if (!token) {
        router.replace("/crm/login");
        return;
      }

      if (!opciones?.silencioso) setLoading(true);
      else setRecargando(true);
      setErrorMsg("");

      try {
        const res = await fetch(`/api/crm/agenda?producto=${tabActiva}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
          localStorage.removeItem("crm_token");
          router.replace("/crm/login");
          return;
        }

        if (!res.ok) {
          setErrorMsg("No se pudo cargar la agenda.");
          return;
        }

        const data = (await res.json()) as AgendaBucketsResponse;
        setAgenda(data);
        setAhora(new Date());
      } catch {
        setErrorMsg("Error de red al consultar la agenda.");
      } finally {
        setLoading(false);
        setRecargando(false);
      }
    },
    [router, tabActiva],
  );

  useEffect(() => {
    void cargarAgenda();
  }, [cargarAgenda]);

  useEffect(() => {
    const timer = setInterval(() => {
      void cargarAgenda({ silencioso: true });
    }, 30_000);
    return () => clearInterval(timer);
  }, [cargarAgenda]);

  useEffect(() => {
    return () => limpiarUndoTimer();
  }, [limpiarUndoTimer]);

  const pendientesHoy = agenda.counts.vencidos + agenda.counts.hoy;

  const estaSemanaPorDia = useMemo(() => {
    const map = new Map<string, LeadAgenda[]>();
    for (const lead of agenda.esta_semana) {
      if (!lead.fecha_contacto) continue;
      const key = diaMexicoKey(lead.fecha_contacto);
      const list = map.get(key) ?? [];
      list.push(lead);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agenda.esta_semana]);

  function cambiarTab(tabId: string) {
    setTabActiva(tabId);
    router.replace(`/crm/agenda?producto=${tabId}`, { scroll: false });
  }

  function cerrarSesion() {
    localStorage.removeItem("crm_token");
    router.replace("/crm/login");
  }

  function removerLeadDeAgenda(leadId: string) {
    setAgenda((prev) => {
      const next = { ...prev, counts: { ...prev.counts } };
      for (const key of Object.keys(next.counts) as AgendaBucket[]) {
        const arr = next[key];
        const filtered = arr.filter((l) => l.id !== leadId);
        if (filtered.length !== arr.length) {
          next[key] = filtered;
          next.counts[key] = filtered.length;
        }
      }
      return next;
    });
  }

  async function marcarContactado(lead: LeadAgenda) {
    if (lead.estado === "contactado") return;

    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    const previousEstado = lead.estado as CrmLeadEstado;
    limpiarUndoTimer();
    removerLeadDeAgenda(lead.id);
    setUndoBar({ leadId: lead.id, previousEstado });
    programarCierreUndoBar();

    const ok = await patchLeadEstado(lead.id, "contactado", token);
    if (!ok) {
      setUndoBar(null);
      limpiarUndoTimer();
      void cargarAgenda({ silencioso: true });
      setErrorMsg("No se pudo marcar como contactado.");
    }
  }

  async function deshacerContactado() {
    if (!undoBar) return;
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    const { leadId, previousEstado } = undoBar;
    limpiarUndoTimer();
    setUndoBar(null);

    const ok = await patchLeadEstado(leadId, previousEstado, token);
    if (!ok) {
      setErrorMsg("No se pudo deshacer el cambio.");
    }
    void cargarAgenda({ silencioso: true });
  }

  const tabActual = TABS.find((t) => t.id === tabActiva);

  return (
    <main className="min-h-screen bg-[#e9edef]">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col shadow-[0_0_40px_rgba(0,0,0,0.08)]">
        <div className="sticky top-0 z-30">
          <header className="bg-[#075E54] text-white">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-xl">
                📅
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-semibold">Agenda de contactos</h1>
                <p className="truncate text-xs text-white/75">
                  {pendientesHoy} lead{pendientesHoy === 1 ? "" : "s"} pendiente
                  {pendientesHoy === 1 ? "" : "s"} para hoy
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title="Recargar agenda"
                  onClick={() => void cargarAgenda({ silencioso: true })}
                  disabled={loading || recargando}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10 disabled:opacity-50"
                >
                  <IconoRecargar
                    className={`h-5 w-5 ${recargando ? "animate-spin" : ""}`}
                  />
                </button>
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

            <div className="px-3 pb-3">
              <div className="flex gap-1 rounded-xl bg-[#064e46] p-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => cambiarTab(tab.id)}
                    className={
                      tabActiva === tab.id
                        ? "flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-1.5 py-2 text-[11px] font-semibold text-[#075E54] shadow-sm"
                        : "flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[11px] font-medium text-white/80 hover:bg-white/10"
                    }
                  >
                    <span aria-hidden>{tab.icon}</span>
                    <span className="truncate">{tab.label}</span>
                  </button>
                ))}
                <Link
                  href={`/crm/leads?producto=${tabActiva}`}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[11px] font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
                >
                  <span aria-hidden>💬</span>
                  <span className="truncate">Bandeja</span>
                </Link>
              </div>
            </div>
          </header>

          <div className="border-b border-slate-200/80 bg-[#f0f2f5] px-4 py-2">
            <p className="text-xs text-slate-500">{TITULOS_TAB[tabActiva] ?? tabActual?.label}</p>
          </div>
        </div>

        {errorMsg ? (
          <p className="mx-3 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
            {errorMsg}
          </p>
        ) : null}

        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Cargando agenda…</p>
        ) : (
          <div className="flex-1 pb-24 pt-1">
            {agenda.counts.vencidos > 0 ? (
              <SeccionAgenda
                titulo="🔴 VENCIDOS"
                colorClass="text-rose-600"
                leads={agenda.vencidos}
                bucket="vencidos"
                ahora={ahora}
                onMarcarContactado={marcarContactado}
              />
            ) : null}

            <SeccionAgenda
              titulo="🟢 HOY"
              colorClass="text-[#128C7E]"
              leads={agenda.hoy}
              bucket="hoy"
              ahora={ahora}
              placeholder="No tienes contactos pendientes para hoy 🎉"
              onMarcarContactado={marcarContactado}
            />

            <SeccionAgenda
              titulo="🔵 MAÑANA"
              colorClass="text-sky-700"
              leads={agenda.manana}
              bucket="manana"
              ahora={ahora}
              onMarcarContactado={marcarContactado}
            />

            {agenda.counts.esta_semana > 0 ? (
              <section className="px-3 py-2">
                <h2 className="mb-2 text-sm font-semibold text-slate-600">
                  ⚪ ESTA SEMANA ({agenda.counts.esta_semana})
                </h2>
                <div className="space-y-2">
                  {estaSemanaPorDia.map(([diaKey, leadsDia]) => {
                    const expandido = diasExpandidos[diaKey] ?? false;
                    const label =
                      leadsDia[0]?.fecha_contacto != null
                        ? formatearDiaCortoAgenda(leadsDia[0].fecha_contacto)
                        : diaKey;
                    return (
                      <div
                        key={diaKey}
                        className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/80"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setDiasExpandidos((prev) => ({
                              ...prev,
                              [diaKey]: !expandido,
                            }))
                          }
                          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <span>
                            {label} · {leadsDia.length} lead
                            {leadsDia.length === 1 ? "" : "s"}
                          </span>
                          <span className="text-slate-400">{expandido ? "▾" : "▸"}</span>
                        </button>
                        {expandido ? (
                          <div className="space-y-2 border-t border-slate-100 p-2">
                            {leadsDia.map((lead) => (
                              <AgendaLeadCard
                                key={lead.id}
                                lead={lead}
                                ahora={ahora}
                                bucket="esta_semana"
                                onMarcarContactado={marcarContactado}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <SeccionAgenda
              titulo="📅 FUTUROS"
              colorClass="text-slate-600"
              leads={agenda.futuros}
              bucket="futuros"
              ahora={ahora}
              onMarcarContactado={marcarContactado}
            />

            {agenda.counts.sin_agendar > 0 ? (
              <section className="px-3 py-2">
                <h2 className="mb-2 text-sm font-semibold text-slate-500">
                  📌 SIN AGENDAR ({agenda.counts.sin_agendar})
                </h2>
                <div className="space-y-2">
                  {agenda.sin_agendar.map((lead) => (
                    <article
                      key={lead.id}
                      className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200/80"
                    >
                      <div className="flex gap-3">
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${avatarLead(lead.producto).bg}`}
                        >
                          {avatarLead(lead.producto).label}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900">
                            {formatearTelefonoDisplay(lead.whatsapp_phone)}
                          </p>
                          {lead.horario?.trim() ? (
                            <p className="mt-0.5 text-xs text-slate-500">
                              Cliente dijo: {lead.horario.trim()}
                            </p>
                          ) : null}
                          <Link
                            href={`/crm/leads/${lead.id}?vista=estado`}
                            className="mt-2 inline-flex rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
                          >
                            Agendar fecha
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}

        {undoBar ? (
          <div className="fixed bottom-4 left-1/2 z-40 w-[min(100%,22rem)] -translate-x-1/2 px-3">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[#075E54] px-4 py-3 text-sm text-white shadow-lg">
              <span>Marcado como {etiquetaEstadoUndo("contactado")}</span>
              <button
                type="button"
                onClick={() => void deshacerContactado()}
                className="shrink-0 font-semibold underline underline-offset-2"
              >
                Deshacer
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
