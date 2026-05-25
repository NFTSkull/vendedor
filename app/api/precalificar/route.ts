import { z } from "zod";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const precalificarBodySchema = z
  .object({
    nss: z.string().min(1),
    phoneNumber: z.string().optional(),
    source: z.enum(["bot", "crm"]).optional().default("bot"),
  })
  .transform((data) => ({
    ...data,
    phoneNumber:
      data.phoneNumber?.trim() ||
      (data.source === "crm" ? `crm-${data.nss.replace(/\D/g, "")}` : ""),
  }))
  .refine((data) => data.phoneNumber.length > 0, {
    message: "Falta phoneNumber",
    path: ["phoneNumber"],
  });

type DatosCredito = {
  montoCredito?: number | string;
  saldoSubcuenta?: number | string;
  capacidadCompra?: number | string;
  pagoMensual?: number | string;
};

type RangosAprobados = {
  minimo?: string;
  maximo?: string;
};

type ResultadoPrecalificacion = {
  califica: boolean;
  nombre?: string;
  nss?: string;
  mensaje?: string;
  datos?: DatosCredito;
  rangosAprobados?: RangosAprobados;
};

const SCRAPER_URL = process.env.SCRAPER_SERVICE_URL;
const SCRAPER_SECRET = process.env.SCRAPER_SECRET;

export async function POST(request: Request) {
  try {
    const parsed = precalificarBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    const { nss, phoneNumber, source } = parsed.data;

    if (!SCRAPER_URL || !SCRAPER_SECRET) {
      return Response.json(
        { error: "Servicio de precalificación no configurado" },
        { status: 500 },
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    let scraperRes: Response;
    try {
      scraperRes = await fetch(`${SCRAPER_URL}/precalificar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-scraper-secret": SCRAPER_SECRET,
        },
        body: JSON.stringify({ nss }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!scraperRes.ok) {
      throw new Error(`Scraper error: ${scraperRes.status}`);
    }

    const resultado = (await scraperRes.json()) as ResultadoPrecalificacion;
    const supabase = getSupabaseAdmin();

    const updateData: Record<string, unknown> = {
      nss,
      precalificacion_status: resultado.califica ? "aprobado" : "rechazado",
      precalificacion_resultado: resultado,
      precalificado_at: new Date().toISOString(),
    };

    if (resultado.califica) {
      updateData.nombre_infonavit = resultado.nombre;
      updateData.monto_credito = resultado.datos?.montoCredito;
      updateData.saldo_subcuenta = resultado.datos?.saldoSubcuenta;
      updateData.capacidad_compra = resultado.datos?.capacidadCompra;
      updateData.pago_mensual = resultado.datos?.pagoMensual;
    }

    const { data: leadExistente } = await supabase
      .from("leads")
      .select("id")
      .eq("whatsapp_phone", phoneNumber)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (leadExistente) {
      await supabase
        .from("leads")
        .update(updateData)
        .eq("id", leadExistente.id);
    } else {
      await supabase.from("leads").insert({
        whatsapp_phone: phoneNumber,
        estado: "nuevo",
        ...updateData,
      });
    }

    if (source !== "crm") {
      const mensaje = resultado.califica
        ? buildMensajeAprobado(resultado)
        : buildMensajeRechazado(resultado);
      await enviarWhatsApp(phoneNumber, mensaje);
    }

    return Response.json({ ok: true, resultado });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Error desconocido";
    return Response.json({ error: msg }, { status: 500 });
  }
}

function buildMensajeAprobado(resultado: ResultadoPrecalificacion) {
  const { nombre, datos } = resultado;
  const nombreFormato = (nombre ?? "")
    .toLowerCase()
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
    .trim();

  const saldoSubcuenta = normalizarNumero(datos?.saldoSubcuenta);
  const montoPrestable = saldoSubcuenta * 0.9;
  const rangoMinimo = Math.floor(montoPrestable * 0.8);
  const rangoMaximo = Math.floor(montoPrestable * 0.85);
  const rangoTexto =
    saldoSubcuenta > 0
      ? `entre *${formatearMoneda(rangoMinimo)}* y *${formatearMoneda(rangoMaximo)}*`
      : "en revisión con nuestro equipo";

  return `✅ *¡Buenas noticias, ${nombreFormato}!*

¡Tu precalificación con Infonavit está lista! 🏠

🎉 *Tu monto aprobado para mejoras con Mejoravit es ${rangoTexto}.*

Un asesor se comunicará contigo en breve. 😊`;
}

function normalizarNumero(value: number | string | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value !== "string") return 0;

  const limpio = value.replace(/[^0-9.]/g, "");
  const num = Number(limpio);
  return Number.isFinite(num) ? num : 0;
}

function formatearMoneda(value: number): string {
  return `$${value.toLocaleString("es-MX")}`;
}

function buildMensajeRechazado(resultado: ResultadoPrecalificacion) {
  const mensajes: Record<string, string> = {
    "SIN RELACION LABORAL VIGENTE":
      "actualmente no cuentas con una relación laboral vigente registrada en el IMSS.",
    "SIN APORTACIONES":
      "no se encontraron aportaciones activas a tu Subcuenta de Vivienda.",
    "NO CUMPLE": "no cumples con los requisitos mínimos en este momento.",
    BAJA: "tu registro aparece como baja en el sistema de Infonavit.",
  };

  const razon =
    mensajes[resultado.mensaje ?? ""] ||
    "no fue posible completar la precalificación.";

  return `ℹ️ *Resultado de tu precalificación*

Revisamos tu NSS *${resultado.nss}* y encontramos que ${razon}

Te recomendamos:
1️⃣ Verificar con tu patrón que tus aportaciones estén al corriente
2️⃣ Consultar en: *my.infonavit.org.mx*

¿Te gustaría que un asesor te contacte? 🤝`;
}

async function enviarWhatsApp(phoneNumber: string, mensaje: string) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phoneNumber,
        type: "text",
        text: { body: mensaje },
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`WhatsApp API error: ${await res.text()}`);
  }

  return res.json();
}
