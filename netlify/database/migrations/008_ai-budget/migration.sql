CREATE TABLE IF NOT EXISTS ai_budget_months (
  month_key text PRIMARY KEY,
  spent_cents integer NOT NULL DEFAULT 0,
  reserved_cents integer NOT NULL DEFAULT 0
);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS estimated_usd numeric(12,8);
