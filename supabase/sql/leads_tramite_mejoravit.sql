-- Trámite Mejoravit capturado por el bot (Paso 1: asesor inteligente).
-- Ejecutar manualmente en Supabase SQL Editor ANTES de desplegar el código que lo usa.
-- Aditiva: no modifica columnas ni datos existentes.

alter table public.leads
  add column if not exists tramite_mejoravit jsonb;

comment on column public.leads.tramite_mejoravit is
  'Trámite Mejoravit del bot: etapa, interés, consentimiento, estimación de crédito, datos capturados con procedencia, campos pendientes, documentos pendientes y versión para concurrencia optimista.';
