"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Redirige al lead unificado (pestaña Chat). */
export default function CrmLeadChatRedirectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const leadId = params.id;

  useEffect(() => {
    if (leadId) {
      router.replace(`/crm/leads/${leadId}?vista=chat`);
    }
  }, [leadId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e9edef]">
      <p className="text-sm text-slate-600">Abriendo chat…</p>
    </main>
  );
}
