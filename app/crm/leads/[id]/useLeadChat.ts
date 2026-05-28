"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type ChatMessage = {
  id: string;
  lead_id: string;
  direccion: "entrante" | "saliente";
  contenido: string;
  created_at: string;
};

export function useLeadChat(leadId: string) {
  const router = useRouter();
  const [mensajes, setMensajes] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensajesAsesorLocales, setMensajesAsesorLocales] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

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

    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

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

  function obtenerOrigenMensaje(msg: ChatMessage): "Cliente" | "Bot" | "Asesor" {
    if (msg.direccion === "entrante") return "Cliente";
    return mensajesAsesorLocales.includes(msg.contenido) ? "Asesor" : "Bot";
  }

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

  return {
    mensajes,
    chatLoading,
    chatError,
    nuevoMensaje,
    setNuevoMensaje,
    enviando,
    enviarMensaje,
    obtenerOrigenMensaje,
    chatEndRef,
    fetchMensajes,
  };
}
