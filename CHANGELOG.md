# Changelog

## [Sin versión semver] — 2026-05-18

### Cambio actual

- **Flujo WhatsApp (textos y pasos):** precalificación (labor NL, Infonavit, crédito activo, centro de trabajo), datos solo NSS (11 dígitos), monto simbólico `__________`, interés, horario de contacto y cierre con teléfonos 8114118767 / 8140100246. Sin cambios en webhook Meta ni variables de entorno.

## [Sin versión semver] — 2026-05-15

### Cambio actual (histórico)

- **Estado conversacional sólo en memoria:** `lib/conversationMemory.ts` (`Map` global por proceso). Confirmación sí → `console.log` con `{ phone, name, nss }` y mensaje fin al usuario.
- **Eliminación de Supabase:** dependencia `@supabase/supabase-js`, `lib/supabaseAdmin.ts` y variables `SUPABASE_*` retiradas.
- Script `npm run next:build` → alias de `next build`.

### Previo — migración sólo Next (Supabase desde entonces revertido aquí)

- Webhook WhatsApp en `/api/webhook` con flujo nombre → NSS → confirmación.

### Previo más antiguo

- Migración inicial **solo Next.js** (sin Express); pruebas Vitest para GET Meta (`hub.*`).

### Eliminado (época Express)

- Servidor Express (`index.js`), `generarRespuesta.js`, vistas estáticas y JSON locales de leads/usuarios.
