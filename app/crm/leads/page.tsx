"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type LeadEstado = "nuevo" | "contactado" | "no_interesado";

type Lead = {
  id: string;
  whatsapp_phone: string;
  nss: string | null;
  horario: string;
  estado: LeadEstado;
  created_at: string;
  precalificacion_status: "aprobado" | "rechazado" | "pendiente" | null;
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

export default function CrmLeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [precalifMsg, setPrecalifMsg] = useState("");

  const nuevosCount = useMemo(
    () => leads.filter((l) => l.estado === "nuevo").length,
    [leads],
  );

  const leadPrecalificable = useMemo(
    () =>
      leads.find(
        (lead) =>
          Boolean(lead.nss) &&
          (lead.precalificacion_status === null ||
            lead.precalificacion_status === "pendiente" ||
            lead.precalificacion_status === "rechazado"),
      ) ?? null,
    [leads],
  );

  async function cargarLeads() {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/crm/leads", {
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

  function irAPrecalificar() {
    if (!leadPrecalificable) {
      setPrecalifMsg("No hay leads con NSS pendientes de precalificación.");
      return;
    }
    setPrecalifMsg("");
    router.push(`/crm/leads/${leadPrecalificable.id}`);
  }

  useEffect(() => {
    void cargarLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
          <div>
            <h1 className="text-2xl font-semibold">Leads Mejoravit</h1>
            <p className="text-sm text-slate-600">
              Nuevos: <span className="font-semibold">{nuevosCount}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={irAPrecalificar}
              disabled={!leadPrecalificable}
              className="self-start md:self-auto rounded-xl bg-blue-600 text-white px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Precalificar
            </button>
            <button
              onClick={cerrarSesion}
              className="self-start md:self-auto rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100"
            >
              Cerrar sesión
            </button>
          </div>
        </header>

        {precalifMsg ? (
          <section className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            {precalifMsg}
          </section>
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
            No hay leads registrados todavía.
          </section>
        ) : (
          <>
            <section className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="text-left p-3">Teléfono</th>
                    <th className="text-left p-3">NSS</th>
                    <th className="text-left p-3">Horario</th>
                    <th className="text-left p-3">Estado</th>
                    <th className="text-left p-3">Fecha</th>
                    <th className="text-left p-3">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="border-t border-slate-100">
                      <td className="p-3">{lead.whatsapp_phone}</td>
                      <td className="p-3">{lead.nss}</td>
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
                      <td className="p-3">
                        {new Date(lead.created_at).toLocaleString("es-MX")}
                      </td>
                      <td className="p-3">
                        <Link
                          href={`/crm/leads/${lead.id}`}
                          className="rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs hover:bg-blue-700"
                        >
                          Ver
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="md:hidden grid gap-3">
              {leads.map((lead) => (
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
                    <p>
                      <span className="font-medium">NSS:</span> {lead.nss}
                    </p>
                    <p>
                      <span className="font-medium">Horario:</span> {lead.horario}
                    </p>
                    <p>
                      <span className="font-medium">Fecha:</span>{" "}
                      {new Date(lead.created_at).toLocaleString("es-MX")}
                    </p>
                  </div>

                  <Link
                    href={`/crm/leads/${lead.id}`}
                    className="mt-3 inline-block rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs hover:bg-blue-700"
                  >
                    Ver
                  </Link>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
