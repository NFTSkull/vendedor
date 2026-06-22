"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ACCEPT_ARCHIVOS_CHAT,
  MAX_ARCHIVO_CHAT_BYTES,
  MSG_ERROR_VENTANA_24H_WHATSAPP,
} from "@/lib/crmMediaUpload";

export { ACCEPT_ARCHIVOS_CHAT };

export type ChatMessage = {
  id: string;
  lead_id: string;
  direccion: "entrante" | "saliente";
  contenido: string;
  created_at: string;
  origen?: "cliente" | "bot" | "asesor";
  advisor_nombre?: string | null;
};

type UseLeadChatOptions = {
  onEnvioExitoso?: () => void | Promise<void>;
};

export function useLeadChat(leadId: string, options?: UseLeadChatOptions) {
  const router = useRouter();
  const [mensajes, setMensajes] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [nuevoMensaje, setNuevoMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviandoArchivo, setEnviandoArchivo] = useState(false);
  const [nombreArchivoPendiente, setNombreArchivoPendiente] = useState("");
  const [mensajesAsesorLocales, setMensajesAsesorLocales] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const usuarioCercaDelFinalRef = useRef(true);
  const forzarScrollRef = useRef(false);
  const esCargaInicialRef = useRef(true);

  const scrollChatAlFinal = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = chatContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const onChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanciaAlFinal = el.scrollHeight - el.scrollTop - el.clientHeight;
    usuarioCercaDelFinalRef.current = distanciaAlFinal < 96;
  }, []);

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

  async function enviarArchivo(file: File) {
    if (file.size > MAX_ARCHIVO_CHAT_BYTES) {
      setChatError("El archivo es muy grande (máx 4 MB)");
      return;
    }

    const token = localStorage.getItem("crm_token");
    if (!token) {
      router.replace("/crm/login");
      return;
    }

    setEnviandoArchivo(true);
    setNombreArchivoPendiente(file.name);
    setChatError("");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch(`/api/crm/leads/${leadId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      if (res.status === 401) {
        localStorage.removeItem("crm_token");
        router.replace("/crm/login");
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };

      if (res.status === 413) {
        setChatError("El archivo es muy grande (máx 4 MB)");
        return;
      }
      if (res.status === 400) {
        setChatError(body.error || "Tipo de archivo no permitido");
        return;
      }
      if (res.status === 502) {
        setChatError(body.error || MSG_ERROR_VENTANA_24H_WHATSAPP);
        return;
      }
      if (!res.ok) {
        setChatError(body.error || "No se pudo enviar el archivo.");
        return;
      }

      const rastro = `📎 ${file.name}`;
      setMensajesAsesorLocales((prev) => [...prev, rastro]);
      forzarScrollRef.current = true;
      await fetchMensajes();
      await options?.onEnvioExitoso?.();
    } catch {
      setChatError("Error de red al enviar archivo.");
    } finally {
      setEnviandoArchivo(false);
      setNombreArchivoPendiente("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function abrirSelectorArchivo() {
    fileInputRef.current?.click();
  }

  function onArchivoSeleccionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void enviarArchivo(file);
  }

  async function enviarMensaje(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.();
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
      forzarScrollRef.current = true;
      await fetchMensajes();
      await options?.onEnvioExitoso?.();
    } catch {
      setChatError("Error de red al enviar mensaje.");
    } finally {
      setEnviando(false);
    }
  }

  function obtenerOrigenMensaje(msg: ChatMessage): string {
    if (msg.origen === "cliente") return "Cliente";
    if (msg.origen === "bot") return "Bot";
    if (msg.origen === "asesor") {
      if (msg.advisor_nombre) return msg.advisor_nombre.toUpperCase();
      return "Asesor";
    }
    if (msg.direccion === "entrante") return "Cliente";
    return mensajesAsesorLocales.includes(msg.contenido) ? "Asesor" : "Bot";
  }

  useEffect(() => {
    if (!leadId) return;
    esCargaInicialRef.current = true;
    usuarioCercaDelFinalRef.current = true;
    void fetchMensajes();
    const timer = setInterval(() => {
      void fetchMensajes();
    }, 10000);
    return () => clearInterval(timer);
  }, [leadId, fetchMensajes]);

  useEffect(() => {
    if (esCargaInicialRef.current) {
      esCargaInicialRef.current = false;
      return;
    }
    if (forzarScrollRef.current || usuarioCercaDelFinalRef.current) {
      scrollChatAlFinal(forzarScrollRef.current ? "smooth" : "auto");
    }
    forzarScrollRef.current = false;
  }, [mensajes, scrollChatAlFinal]);

  return {
    mensajes,
    chatLoading,
    chatError,
    nuevoMensaje,
    setNuevoMensaje,
    enviando,
    enviandoArchivo,
    nombreArchivoPendiente,
    enviarMensaje,
    enviarArchivo,
    abrirSelectorArchivo,
    onArchivoSeleccionado,
    fileInputRef,
    obtenerOrigenMensaje,
    chatContainerRef,
    chatEndRef,
    onChatScroll,
    scrollChatAlFinal,
    fetchMensajes,
  };
}
