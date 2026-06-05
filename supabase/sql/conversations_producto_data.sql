-- Paso 5: producto + data JSONB en conversations
-- Ejecutar manualmente en el SQL Editor de Supabase.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS producto TEXT DEFAULT 'mejoravit';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;

UPDATE conversations
SET producto = 'mejoravit'
WHERE producto IS NULL;

UPDATE conversations
SET data = '{}'::jsonb
WHERE data IS NULL;
