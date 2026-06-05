"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  formatearMoneda,
  motivoRechazoLegible,
  normalizarNumero,
  nssSoloDigitos,
  nssValido,
  type ResultadoPrecalificacionApi,
} from "@/lib/precalificacionDisplay";

type LeadEstado = "nuevo" | "contactado" | "no_interesado";

const TABS = [
  { id: "mejoravit", label: "Mejoravit" },
  { id: "paneles", label: "Paneles" },
  { id: "generadores", label: "Generadores" },
] as const;

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
  created_at: string;
  precalificacion_status: "aprobado" | "rechazado" | "pendiente" | null;
  saldo_subcuenta: number | string | null;
  monto_base: number | string | null;
  monto_aprobado_min: number | string | null;
  monto_aprobado_max: number | string | null;
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

function resumenPrecalificacionLead(lead: Lead): {
  saldoSubcuenta: string;
  montoBase: string;
  rangoAprobado: string;
} {
  const saldoSubcuenta = normalizarNumero(lead.saldo_subcuenta ?? undefined);
  const montoBase = normalizarNumero(lead.monto_base ?? undefined);
  const montoMin = normalizarNumero(lead.monto_aprobado_min ?? undefined);
  const montoMax = normalizarNumero(lead.monto_aprobado_max ?? undefined);
  return {
    saldoSubcuenta: saldoSubcuenta > 0 ? formatearMoneda(saldoSubcuenta) : "Sin dato",
    montoBase: montoBase > 0 ? formatearMoneda(montoBase) : "Sin dato",
    rangoAprobado:
      montoMin > 0 && montoMax > 0
        ? `${formatearMoneda(montoMin)} – ${formatearMoneda(montoMax)}`
        : "Sin dato",
  };
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

export default function CrmLeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [tabActiva, setTabActiva] = useState<string>("mejoravit");

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

  const nuevosCount = useMemo(
    () => leads.filter((l) => l.estado === "nuevo").length,
    [leads],
  );

  const saldoSubcuenta = normalizarNumero(resultado?.datos?.saldoSubcuenta);
  const esMejoravit = tabActiva === "mejoravit";

  async function cargarLeads() {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    setLoading(true);
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
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabActiva]);

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
          <div>
            <h1 className="text-2xl font-semibold">
              {TITULOS_TAB[tabActiva] ?? "Leads"}
            </h1>
            <p className="text-sm text-slate-600">
              Nuevos: <span className="font-semibold">{nuevosCount}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void activarNotificaciones()}
              disabled={activandoPush}
              className="self-start md:self-auto rounded-xl border border-emerald-600 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            >
              {activandoPush ? "Activando..." : "Activar notificaciones"}
            </button>
            {esMejoravit ? (
              <button
                type="button"
                onClick={abrirModalPrecalificar}
                className="self-start md:self-auto rounded-xl bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
              >
                Precalificar
              </button>
            ) : null}
            <button
              type="button"
              onClick={cerrarSesion}
              className="self-start md:self-auto rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        <nav className="flex gap-2 mb-5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTabActiva(tab.id)}
              className={
                tabActiva === tab.id
                  ? "rounded-xl bg-blue-600 text-white px-4 py-2 text-sm font-medium"
                  : "rounded-xl border border-slate-300 text-slate-700 px-4 py-2 text-sm hover:bg-slate-50"
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {pushMsg ? (
          <p className="mb-3 text-sm text-slate-600">{pushMsg}</p>
        ) : null}

        {loading ? (
          <section className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-slate-200 animate-pulse"
              />
            ))}
          </section>
        ) : errorMsg ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {errorMsg}
          </section>
        ) : leads.length === 0 ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
            {esMejoravit ? (
              <>
                No hay leads registrados todavía. Usa{" "}
                <span className="font-medium">Precalificar</span> para consultar un
                NSS en Infonavit.
              </>
            ) : (
              <>No hay leads registrados todavía en esta categoría.</>
            )}
          </section>
        ) : (
          <>
            <section className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="text-left p-3">Teléfono</th>
                    {esMejoravit ? <th className="text-left p-3">NSS</th> : null}
                    <th className="text-left p-3">Horario</th>
                    <th className="text-left p-3">Estado</th>
                    {esMejoravit ? (
                      <th className="text-left p-3">Precalificación</th>
                    ) : null}
                    <th className="text-left p-3">Fecha</th>
                    <th className="text-left p-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="border-t border-slate-100 align-top">
                      <td className="p-3">{lead.whatsapp_phone}</td>
                      {esMejoravit ? (
                        <td className="p-3">{lead.nss ?? "—"}</td>
                      ) : null}
                      <td className="p-3">{lead.horario}</td>
                      <td className="p-3">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${estadoBadge(
                            lead.estado,
                          )}`}
                        >
                          {lead.estado}
                        </span>
                      </td>
                      {esMejoravit ? (
                        <td className="p-3 text-xs text-slate-700">
                          {(() => {
                            const resumen = resumenPrecalificacionLead(lead);
                            return (
                              <div className="space-y-1">
                                <p>
                                  <span className="font-medium">Saldo subcuenta:</span>{" "}
                                  {resumen.saldoSubcuenta}
                                </p>
                                <p>
                                  <span className="font-medium">Después de descuento (×0.9):</span>{" "}
                                  {resumen.montoBase}
                                </p>
                                <p>
                                  <span className="font-medium">Rango aprobado:</span>{" "}
                                  {resumen.rangoAprobado}
                                </p>
                              </div>
                            );
                          })()}
                        </td>
                      ) : null}
                      <td className="p-3">
                        {new Date(lead.created_at).toLocaleString("es-MX")}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/crm/leads/${lead.id}`}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                          >
                            Ver
                          </Link>
                          <Link
                            href={`/crm/leads/${lead.id}/chat`}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
                          >
                            Chat
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="md:hidden grid gap-3">
              {leads.map((lead) => (
                (() => {
                  const resumen = esMejoravit
                    ? resumenPrecalificacionLead(lead)
                    : null;
                  return (
                <article
                  key={lead.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{lead.whatsapp_phone}</p>
                    <span
                      className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${estadoBadge(
                        lead.estado,
                      )}`}
                    >
                      {lead.estado}
                    </span>
                  </div>

                  <div className="mt-2 text-sm text-slate-700 space-y-1">
                    {esMejoravit ? (
                      <p>
                        <span className="font-medium">NSS:</span>{" "}
                        {lead.nss ?? "—"}
                      </p>
                    ) : null}
                    <p>
                      <span className="font-medium">Horario:</span> {lead.horario}
                    </p>
                    <p>
                      <span className="font-medium">Fecha:</span>{" "}
                      {new Date(lead.created_at).toLocaleString("es-MX")}
                    </p>
                    {resumen ? (
                      <>
                        <p>
                          <span className="font-medium">Saldo subcuenta:</span>{" "}
                          {resumen.saldoSubcuenta}
                        </p>
                        <p>
                          <span className="font-medium">Después de descuento (×0.9):</span>{" "}
                          {resumen.montoBase}
                        </p>
                        <p>
                          <span className="font-medium">Rango aprobado:</span>{" "}
                          {resumen.rangoAprobado}
                        </p>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={`/crm/leads/${lead.id}`}
                      className="inline-block rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                    >
                      Ver
                    </Link>
                    <Link
                      href={`/crm/leads/${lead.id}/chat`}
                      className="inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
                    >
                      Chat
                    </Link>
                  </div>
                </article>
                  );
                })()
              ))}
            </section>
          </>
        )}
      </div>

      {modalAbierto ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={cerrarModal}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">Precalificar en Infonavit</h2>
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
    </main>
  );
}
