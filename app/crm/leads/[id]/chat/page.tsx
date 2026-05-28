"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { type ChatMessage, useLeadChat } from "../useLeadChat";

type LeadEstado = "nuevo" | "contactado" | "no_interesado";

type Lead = {
  id: string;
  whatsapp_phone: string;
  nss: string | null;
  estado: LeadEstado;
  created_at: string;
  updated_at: string;
};

function fechaSeparador(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function horaMensaje(dateIso: string): string {
  return new Date(dateIso).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diaKey(dateIso: string): string {
  const d = new Date(dateIso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function CrmLeadChatFullscreenPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const leadId = params.id;
  const [lead, setLead] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(true);
  const [leadError, setLeadError] = useState("");

  const {
    mensajes,
    chatLoading,
    chatError,
    nuevoMensaje,
    setNuevoMensaje,
    enviando,
    enviarMensaje,
    obtenerOrigenMensaje,
    chatEndRef,
  } = useLeadChat(leadId);

  const chatHabilitado =
    lead?.estado === "nuevo" ||
    lead?.estado === "contactado" ||
    lead?.estado === "no_interesado";

  const inicialTelefono = useMemo(() => {
    if (!lead?.whatsapp_phone) return "?";
    const firstDigit = lead.whatsapp_phone.replace(/\D/g, "").charAt(0);
    return firstDigit || lead.whatsapp_phone.charAt(0).toUpperCase();
  }, [lead?.whatsapp_phone]);

  async function fetchLead() {
    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    setLoadingLead(true);
    setLeadError("");
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
        setLeadError("Lead no encontrado.");
        return;
      }
      if (!res.ok) {
        setLeadError("No se pudo cargar el lead.");
        return;
      }
      setLead((await res.json()) as Lead);
    } catch {
      setLeadError("Error de red al cargar el lead.");
    } finally {
      setLoadingLead(false);
    }
  }

  useEffect(() => {
    if (leadId) void fetchLead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  return (
    <main className="h-screen bg-[#ECE5DD]">
      <div className="mx-auto flex h-full max-w-5xl flex-col border-x border-slate-200 bg-white">
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-[#075E54] px-3 py-2 text-white md:px-4">
          <button
            onClick={() => router.push(`/crm/leads/${leadId}`)}
            className="rounded-md px-2 py-1 text-sm hover:bg-black/10"
          >
            ← Volver
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
            {inicialTelefono}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold md:text-base">
              {loadingLead ? "Cargando lead..." : (lead?.whatsapp_phone ?? "Sin teléfono")}
            </p>
            <p className="truncate text-xs text-emerald-100">
              NSS: {lead?.nss ?? "Sin dato"}
            </p>
          </div>
        </header>

        {leadError ? (
          <section className="m-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {leadError}
          </section>
        ) : null}

        <section className="min-h-0 flex-1 overflow-y-auto bg-[#ECE5DD] px-3 py-4 md:px-4">
          {chatLoading && mensajes.length === 0 ? (
            <div className="space-y-2">
              <div className="h-10 w-2/3 rounded-lg bg-slate-200/90 animate-pulse" />
              <div className="ml-auto h-10 w-1/2 rounded-lg bg-slate-200/90 animate-pulse" />
            </div>
          ) : mensajes.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sin mensajes todavía.</p>
          ) : (
            mensajes.map((msg, index) => {
              const prev = index > 0 ? mensajes[index - 1] : null;
              const cambiaDia = !prev || diaKey(prev.created_at) !== diaKey(msg.created_at);
              return (
                <div key={msg.id}>
                  {cambiaDia ? (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] text-slate-600 shadow-sm">
                        {fechaSeparador(msg.created_at)}
                      </span>
                    </div>
                  ) : null}
                  <MensajeBurbuja
                    msg={msg}
                    origen={obtenerOrigenMensaje(msg)}
                    hora={horaMensaje(msg.created_at)}
                  />
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </section>

        {chatError ? (
          <p className="border-t border-slate-200 bg-white px-4 pt-2 text-sm text-red-600">
            {chatError}
          </p>
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
            aria-label="Enviar mensaje"
            disabled={!chatHabilitado || enviando || !nuevoMensaje.trim()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-base text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {enviando ? "…" : "➤"}
          </button>
        </form>
      </div>
    </main>
  );
}

function MensajeBurbuja(args: {
  msg: ChatMessage;
  hora: string;
  origen: "Cliente" | "Bot" | "Asesor";
}) {
  const esSaliente = args.msg.direccion === "saliente";
  return (
    <div className={`mb-2 flex ${esSaliente ? "justify-end" : "justify-start"}`}>
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
        <p className="whitespace-pre-wrap break-words pr-10">{args.msg.contenido}</p>
        <div className="mt-1 flex flex-col items-end leading-tight text-[10px] text-slate-500">
          <span>{args.hora}</span>
          <span className="text-[9px] uppercase tracking-wide">{args.origen}</span>
        </div>
      </div>
    </div>
  );
}
