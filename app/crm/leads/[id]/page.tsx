"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type LeadEstado = "nuevo" | "contactado" | "no_interesado";

type Lead = {
  id: string;
  whatsapp_phone: string;
  nss: string;
  horario: string;
  estado: LeadEstado;
  created_at: string;
  updated_at: string;
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

  async function fetchLead() {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

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

  async function actualizarEstado(estado: "contactado" | "no_interesado") {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

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
    } catch {
      setErrorMsg("Error de red al actualizar.");
    } finally {
      setSaving(false);
    }
  }

  function onSubmitNota(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
  }

  useEffect(() => {
    if (leadId) void fetchLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

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

            <form onSubmit={onSubmitNota} className="mt-5">
              <label htmlFor="nota" className="block text-sm font-medium mb-1">
                Nota (opcional)
              </label>
              <textarea
                id="nota"
                rows={4}
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
        ) : null}
      </div>
    </main>
  );
}
