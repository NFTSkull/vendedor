# Vendedor Mejoravit (Next.js)

Servidor **Next.js** con webhook WhatsApp Cloud API en `POST|GET /api/webhook`.

La conversación se mantiene en un **`Map` en memoria** por proceso (`lib/conversationMemory.ts`). En Vercel/serverless el estado puede resetearse en cold starts y no está compartido entre instancias.

## Requisitos

- Node.js 18+
- Cuenta [Meta for Developers](https://developers.facebook.com/) con WhatsApp Cloud API

## Variables de entorno

Copiar `.env.example` a `.env.local` en local; en **Vercel** definir las mismas claves.

| Variable | Uso |
|----------|-----|
| `WHATSAPP_VERIFY_TOKEN` | Verificación GET del webhook (Meta) |
| `WHATSAPP_ACCESS_TOKEN` | Bearer token para enviar mensajes (Graph) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número en Graph |
| `WHATSAPP_GRAPH_API_VERSION` | Opcional; por defecto `lib/whatsappCloud.ts` usa `v19.0` |

## Desarrollo

```bash
npm install
npm run dev
```

Webhook local: túnel (ngrok/etc.) → `http://localhost:3000`; en Meta registra **`https://<tu-host>/api/webhook`**.

## Producción

- Framework: **Next.js**
- Callback URL en Meta: `https://<dominio>/api/webhook`

```bash
npm run build
npm run start
```

## Pruebas y calidad

```bash
npm run lint && npm run typecheck && npm test && npm run next:build
```
