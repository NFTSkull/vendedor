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
| `WHATSAPP_DEFAULT_OWNER` | Owner lógico del número por defecto (fallback env); default `bot_principal` |
| `WHATSAPP_MULTI_NUMBER_ENABLED` | Documentado para fase posterior; **debe quedar `false`** hasta integrar webhook |

### Conectar Jefe 1 (Embedded Signup v3)

- Página: `/conectar-whatsapp?setup_token=<WHATSAPP_SETUP_TOKEN>` (el token se valida en servidor; no va en el bundle).
- API: `POST /api/meta/embedded-signup` con header `x-whatsapp-setup-token` y body `{ code, sessionInfo? }`.
- Requiere dominio en **Allowed domains** y **Valid OAuth redirect URIs** de la app Meta.
- **No modifica** el webhook ni el número actual en producción.

### Multi-número (preparación)

- SQL: `supabase/sql/whatsapp_accounts.sql` — ejecutar en Supabase SQL Editor.
- Resolver: `lib/whatsappAccountResolver.ts` — con tabla vacía, el bot en producción sigue usando solo `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_ACCESS_TOKEN` (el webhook **no** usa el resolver todavía).

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
