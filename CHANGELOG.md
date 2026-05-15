# Changelog

## [Sin versión semver] — 2026-05-15

- Añade Next.js (App Router): webhook en `POST|GET /api/webhook`.
- Variables `WHATSAPP_*` documentadas en `.env.example`; secretos locales en `.env.local` (ignorado por Git).
- Pruebas con Vitest para verificación Meta `hub.*` GET.
- Ajusta el flujo de precalificación en `generarRespuesta.js` con validaciones por etapas:
  relación laboral vigente en Nuevo León, alta en INFONAVIT, crédito activo y centro de trabajo en Nuevo León.
- Se agregan respuestas de corte cuando el usuario responde "no" en requisitos obligatorios.
- Nuevo test `lib/generarRespuestaFlujo.test.ts` cubriendo camino feliz y cortes de elegibilidad.
