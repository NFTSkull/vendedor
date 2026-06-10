-- Asignación de leads a asesores por prefijo en mensaje inicial
-- Ejecutar manualmente en el SQL Editor de Supabase.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS advisor_id uuid REFERENCES advisors(id);

CREATE INDEX IF NOT EXISTS leads_advisor_id_idx
  ON leads (advisor_id);
