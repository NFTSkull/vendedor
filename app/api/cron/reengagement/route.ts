import { autorizadoCron } from "@/lib/reengagement";
import { ejecutarReengagementCron } from "@/lib/reengagementCron";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!autorizadoCron(req)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const resumen = await ejecutarReengagementCron();
    return Response.json({ ok: true, ...resumen });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
