-- Paso 1 + 2: columna producto en leads
-- Ejecutar manualmente en el SQL Editor de Supabase.

-- ---------------------------------------------------------------------------
-- Paso 1 — Migración
-- ---------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS producto TEXT NOT NULL DEFAULT 'mejoravit';

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_producto_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_producto_check
  CHECK (producto IN ('mejoravit', 'paneles', 'generadores', 'sin_clasificar'));

CREATE INDEX IF NOT EXISTS leads_producto_idx
  ON leads (producto);

-- ---------------------------------------------------------------------------
-- Paso 2 — Backfill explícito (redundante con DEFAULT, pero documentado)
-- ---------------------------------------------------------------------------
UPDATE leads
SET producto = 'mejoravit'
WHERE producto IS NULL;
