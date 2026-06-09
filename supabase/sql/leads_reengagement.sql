-- Re-engagement automático: timestamps de toques enviados por WhatsApp
-- Ejecutar manualmente en el SQL Editor de Supabase.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reengagement_1_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reengagement_2_sent_at timestamptz;
