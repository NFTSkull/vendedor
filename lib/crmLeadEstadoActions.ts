export type CrmLeadEstado = "nuevo" | "contactado" | "no_interesado";

export async function patchLeadEstado(
  leadId: string,
  estado: CrmLeadEstado,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/crm/leads/${leadId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ estado }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function etiquetaEstadoUndo(estado: CrmLeadEstado): string {
  return estado === "contactado" ? "contactado" : "no interesado";
}

export function telLead(whatsappPhone: string): string {
  const digits = whatsappPhone.replace(/\D/g, "");
  return digits ? `tel:+${digits}` : `tel:${whatsappPhone}`;
}
