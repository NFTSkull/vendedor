import { autorizadoCron } from "@/lib/reengagement";
import {
  ejecutarReengagementCron,
  metricasCronSinDatosPersonales,
} from "@/lib/reengagementCron";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!autorizadoCron(req)) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const metricas = metricasCronSinDatosPersonales(
      await ejecutarReengagementCron(),
    );
    console.info("[cron reengagement]", JSON.stringify(metricas));
    return Response.json({ ok: true, ...metricas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[cron reengagement] Error:", msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
