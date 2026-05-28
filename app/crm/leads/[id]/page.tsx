"use client";

import { useParams, useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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

function calcularRangoAprobado(saldoSubcuenta: number): { min: number; max: number } {
  const montoPrestable = saldoSubcuenta * 0.9;
  return {
    min: Math.floor(montoPrestable * 0.8),
    max: Math.floor(montoPrestable * 0.85),
  };
}

type ChatMessage = {
  id: string;
  lead_id: string;
  direccion: "entrante" | "saliente";
  contenido: string;
  created_at: string;
};

function estadoBadge(estado: LeadEstado): string {
  if (estado === "contactado") {
    return "bg-emerald-100 text-emerald-700 border-emerald-200";
  }
  if (estado === "no_interesado") {
    return "bg-slate-100 text-slate-700 border-slate-200";
  }
  return "bg-blue-100 text-blue-700 border-blue-200";
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

  const [mensajes, setMensajes] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensajesAsesorLocales, setMensajesAsesorLocales] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

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
    } catch {
      setErrorMsg("Error de red al cargar el lead.");
    } finally {
      setLoading(false);
    }
  }

  const fetchMensajes = useCallback(async () => {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    setChatLoading(true);
    setChatError("");

    try {
      const res = await fetch(`/api/crm/leads/${leadId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      if (!res.ok) {
        setChatError("No se pudo cargar el historial de mensajes.");
        return;
      }

      const data = (await res.json()) as ChatMessage[];
      setMensajes(data);
    } catch {
      setChatError("Error de red al cargar mensajes.");
    } finally {
      setChatLoading(false);
    }
  }, [leadId, router]);

  async function enviarMensaje(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const texto = nuevoMensaje.trim();
    if (!texto) return;

    const token = getToken();
    if (!token) return;

    setEnviando(true);
    setChatError("");

    try {
      const res = await fetch(`/api/crm/leads/${leadId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mensaje: texto }),
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setChatError(err.error || "No se pudo enviar el mensaje.");
        return;
      }

      setNuevoMensaje("");
      setMensajesAsesorLocales((prev) => [...prev, texto]);
      await fetchMensajes();
    } catch {
      setChatError("Error de red al enviar mensaje.");
    } finally {
      setEnviando(false);
    }
  }

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

  function onSubmitNota(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
  }

  useEffect(() => {
    if (leadId) void fetchLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;
    void fetchMensajes();
    const timer = setInterval(() => {
      void fetchMensajes();
    }, 10000);
    return () => clearInterval(timer);
  }, [leadId, fetchMensajes]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  const chatHabilitado =
    lead?.estado === "nuevo" ||
    lead?.estado === "contactado" ||
    lead?.estado === "no_interesado";

  function obtenerOrigenMensaje(msg: ChatMessage): "Cliente" | "Bot" | "Asesor" {
    if (msg.direccion === "entrante") return "Cliente";
    return mensajesAsesorLocales.includes(msg.contenido) ? "Asesor" : "Bot";
  }

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
  const montoBaseValor = tieneSaldoSubcuenta
    ? normalizarNumero(lead.monto_base) || Math.floor(saldoSubcuentaValor * 0.9)
    : 0;
  const montoMinValor = tieneSaldoSubcuenta
    ? normalizarNumero(lead.monto_aprobado_min) ||
      Math.floor(saldoSubcuentaValor * 0.9 * 0.8)
    : 0;
  const montoMaxValor = tieneSaldoSubcuenta
    ? normalizarNumero(lead.monto_aprobado_max) ||
      Math.floor((saldoSubcuentaValor * 0.9) / 0.85)
    : 0;
  const rangoAprobado =
    saldoSubcuentaValor > 0 ? calcularRangoAprobado(saldoSubcuentaValor) : null;

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => router.push("/crm/leads")}
          className="mb-4 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        >
          Volver a la lista
        </button>

        {loading ? (
          <div className="rounded-xl bg-slate-200 h-52 animate-pulse" />
        ) : errorMsg && !lead ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {errorMsg}
          </section>
        ) : lead ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-xl md:text-2xl font-semibold">Detalle de lead</h1>
                <span
                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${estadoBadge(
                    lead.estado,
                  )}`}
                >
                  {lead.estado}
                </span>
              </div>

              <div className="mt-5 grid gap-3 text-sm">
                <p>
                  <span className="font-medium">Teléfono:</span> {lead.whatsapp_phone}
                </p>
                <p>
                  <span className="font-medium">NSS:</span> {lead.nss}
                </p>
                <p>
                  <span className="font-medium">Horario:</span> {lead.horario}
                </p>
                <p>
                  <span className="font-medium">Fecha alta:</span>{" "}
                  {new Date(lead.created_at).toLocaleString("es-MX")}
                </p>
                <p>
                  <span className="font-medium">Última actualización:</span>{" "}
                  {new Date(lead.updated_at).toLocaleString("es-MX")}
                </p>
              </div>

              <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold">Precalificación Infonavit</h2>
                  {!tieneSaldoSubcuenta && puedePrecalificar ? (
                    <button
                      onClick={() => void precalificarLead()}
                      disabled={precalificando}
                      className="rounded-xl bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                    >
                      {precalificando
                        ? "Consultando Infonavit..."
                        : lead.precalificado_at
                          ? "Re-precalificar"
                          : "Precalificar"}
                    </button>
                  ) : null}
                </div>

                {tieneSaldoSubcuenta ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800">
                    <p>
                      <span className="font-medium">Saldo subcuenta:</span>{" "}
                      {formatearMoneda(saldoSubcuentaValor)}
                    </p>
                    <p>
                      <span className="font-medium">Después de descuento (×0.9):</span>{" "}
                      {formatearMoneda(montoBaseValor)}
                    </p>
                    <p>
                      <span className="font-medium">Rango aprobado:</span>{" "}
                      {formatearMoneda(montoMinValor)} – {formatearMoneda(montoMaxValor)}
                    </p>
                  </div>
                ) : lead.precalificado_at ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Última consulta: {new Date(lead.precalificado_at).toLocaleString("es-MX")}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">
                    Aún no se ha consultado la precalificación de este lead.
                  </p>
                )}

                {lead.precalificacion_status === "aprobado" ? (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                    <span className="inline-flex rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700">
                      ✅ Aprobado
                    </span>
                    <div className="mt-2 grid gap-1 text-slate-800">
                      <p>
                        <span className="font-medium">Titular:</span>{" "}
                        {lead.nombre_infonavit ?? "Sin dato"}
                      </p>
                      <p>
                        <span className="font-medium">Monto aprobado:</span>{" "}
                        {rangoAprobado
                          ? `${formatearMoneda(rangoAprobado.min)} a ${formatearMoneda(
                              rangoAprobado.max,
                            )}`
                          : "Sin dato"}
                      </p>
                      <p>
                        <span className="font-medium">Capacidad de compra:</span>{" "}
                        {lead.capacidad_compra
                          ? formatearMoneda(normalizarNumero(lead.capacidad_compra))
                          : "Sin dato"}
                      </p>
                      <p>
                        <span className="font-medium">Pago mensual estimado:</span>{" "}
                        {lead.pago_mensual
                          ? formatearMoneda(normalizarNumero(lead.pago_mensual))
                          : "Sin dato"}
                      </p>
                    </div>
                  </div>
                ) : null}

                {lead.precalificacion_status === "rechazado" ? (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                    <span className="inline-flex rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700">
                      ❌ No califica
                    </span>
                    <p className="mt-2 text-slate-800">
                      <span className="font-medium">Motivo:</span>{" "}
                      {resultadoGuardado?.mensaje ?? "No disponible"}
                    </p>
                  </div>
                ) : null}

                {precalificacionError ? (
                  <p className="mt-3 text-sm text-red-600">{precalificacionError}</p>
                ) : null}
                {precalificacionOk ? (
                  <p className="mt-3 text-sm text-emerald-600">{precalificacionOk}</p>
                ) : null}
              </section>

              <form onSubmit={onSubmitNota} className="mt-5">
                <label htmlFor="nota" className="block text-sm font-medium mb-1">
                  Nota (opcional)
                </label>
                <textarea
                  id="nota"
                  rows={3}
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Escribe una nota para el historial..."
                />
              </form>

              {errorMsg ? <p className="mt-3 text-sm text-red-600">{errorMsg}</p> : null}
              {okMsg ? <p className="mt-3 text-sm text-emerald-600">{okMsg}</p> : null}

              {lead.estado === "nuevo" ? (
                <div className="mt-5 flex flex-col sm:flex-row gap-2">
                  <button
                    disabled={saving}
                    onClick={() => actualizarEstado("contactado")}
                    className="rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {saving ? "Guardando..." : "Marcar como contactado"}
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => actualizarEstado("no_interesado")}
                    className="rounded-xl bg-slate-700 text-white px-4 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? "Guardando..." : "No interesado"}
                  </button>
                </div>
              ) : (
                <p className="mt-5 text-sm text-slate-600">
                  Este lead ya está marcado como{" "}
                  <span className="font-medium">{lead.estado}</span>.
                </p>
              )}
            </section>

            <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 bg-[#F0F2F5] px-4 py-3 md:px-5">
                <h2 className="text-lg font-semibold">Chat con cliente</h2>
              </div>

              {!chatHabilitado ? (
                <p className="px-4 pt-3 text-sm text-slate-600 md:px-5">
                  El chat no está disponible para el estado actual del lead.
                </p>
              ) : null}

              <div className="h-[28rem] overflow-y-auto bg-[#ECE5DD] px-3 py-4 md:px-4">
                {chatLoading && mensajes.length === 0 ? (
                  <div className="space-y-2">
                    <div className="h-10 w-2/3 rounded-lg bg-slate-200/90 animate-pulse" />
                    <div className="ml-auto h-10 w-1/2 rounded-lg bg-slate-200/90 animate-pulse" />
                  </div>
                ) : mensajes.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    Sin mensajes todavía.
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
                              ? "bg-[#DCF8C6] text-slate-900 rounded-br-[4px]"
                              : "bg-white text-slate-900 rounded-bl-[4px]"
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`absolute top-0 h-0 w-0 border-y-[8px] border-y-transparent ${
                              esSaliente
                                ? "right-0 translate-x-[8px] border-l-[10px] border-l-[#DCF8C6]"
                                : "left-0 -translate-x-[8px] border-r-[10px] border-r-white"
                            }`}
                          />
                          <p className="whitespace-pre-wrap break-words pr-10">{msg.contenido}</p>
                          <div className="mt-1 flex flex-col items-end leading-tight text-[10px] text-slate-500">
                            <span>
                              {new Date(msg.created_at).toLocaleString("es-MX", {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "2-digit",
                                month: "2-digit",
                              })}
                            </span>
                            <span className="text-[9px] uppercase tracking-wide">{origen}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {chatError ? (
                <p className="px-4 pt-2 text-sm text-red-600 md:px-5">{chatError}</p>
              ) : null}

              <form
                onSubmit={enviarMensaje}
                className="sticky bottom-0 flex items-center gap-2 border-t border-slate-200 bg-[#F0F2F5] px-3 py-2 md:px-4"
              >
                <input
                  type="text"
                  value={nuevoMensaje}
                  onChange={(e) => setNuevoMensaje(e.target.value)}
                  disabled={!chatHabilitado || enviando}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100"
                />
                <button
                  type="submit"
                  disabled={!chatHabilitado || enviando || !nuevoMensaje.trim()}
                  aria-label="Enviar mensaje"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-base text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {enviando ? "…" : "➤"}
                </button>
              </form>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
