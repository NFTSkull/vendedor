import { getConversation, setConversation } from "@/lib/conversationMemory";
import { actualizarLeadPorConversacion } from "@/lib/leadProvisional";

const PREGUNTA_TIPO =
  "¿El generador es para uso industrial o residencial?";
const PREGUNTA_EQUIPOS = "¿Qué equipos necesitas respaldar?";
const PREGUNTA_HORARIO = "¿En qué día y horario te podemos contactar?";
const MSG_CIERRE =
  "¡Listo! Un asesor de Energrum te contactará en el día y horario que indicaste para cotizar tu generador. ⚡";

type GenStep = "tipo" | "equipos" | "horario";

function genStepDeData(data: Record<string, unknown> | undefined): GenStep | null {
  const step = data?.genStep;
  if (step === "tipo" || step === "equipos" || step === "horario") {
    return step;
  }
  return null;
}

export async function procesarYEvolucionarGeneradores(args: {
  phone: string;
  textoUsuario: string;
}): Promise<string | null> {
  const texto = args.textoUsuario.trim();
  if (!texto) return null;

  const phone = args.phone;
  const conv = await getConversation(phone);

  if (conv.state === "finalizado") {
    return MSG_CIERRE;
  }

  const genStep = genStepDeData(conv.data);

  if (!genStep) {
    await setConversation(phone, {
      state: conv.state,
      lead_id: conv.lead_id,
      nss: conv.nss,
      producto: conv.producto,
      data: { ...(conv.data ?? {}), genStep: "tipo" },
    });
    return PREGUNTA_TIPO;
  }

  if (genStep === "tipo") {
    await setConversation(phone, {
      state: conv.state,
      lead_id: conv.lead_id,
      nss: conv.nss,
      producto: conv.producto,
      data: {
        ...(conv.data ?? {}),
        gen_tipo: texto,
        genStep: "equipos",
      },
    });
    return PREGUNTA_EQUIPOS;
  }

  if (genStep === "equipos") {
    await setConversation(phone, {
      state: conv.state,
      lead_id: conv.lead_id,
      nss: conv.nss,
      producto: conv.producto,
      data: {
        ...(conv.data ?? {}),
        gen_equipos: texto,
        genStep: "horario",
      },
    });
    return PREGUNTA_HORARIO;
  }

  const genTipo =
    typeof conv.data?.gen_tipo === "string" ? conv.data.gen_tipo : "";
  const genEquipos =
    typeof conv.data?.gen_equipos === "string" ? conv.data.gen_equipos : "";

  const nota = `Generador — Uso: ${genTipo || "N/D"}. Equipos a respaldar: ${genEquipos || "N/D"}.`;

  const ok = await actualizarLeadPorConversacion(phone, {
    estado: "nuevo",
    horario: texto,
    nota,
  });
  if (!ok) {
    console.error("[generadores] Error actualizando lead:", { phone });
  }

  await setConversation(phone, {
    state: "finalizado",
    lead_id: conv.lead_id,
    nss: conv.nss,
    producto: conv.producto,
    data: {
      ...(conv.data ?? {}),
      gen_horario: texto,
      genStep: "horario",
    },
  });

  return MSG_CIERRE;
}
