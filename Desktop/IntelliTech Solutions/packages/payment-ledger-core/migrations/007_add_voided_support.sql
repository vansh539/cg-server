-- Additive-only, backward-safe for every client: existing rows default to
-- voided=false / their current status, so customer_balances sums exactly
-- what it did before for anyone who never sets these. Built for Aaral's
-- invoice void/edit feature but lives here since dues/payment_claims are
-- core tables.
ALTER TABLE dues ADD COLUMN voided boolean NOT NULL DEFAULT false;

ALTER TABLE payment_claims DROP CONSTRAINT payment_claims_status_check;
ALTER TABLE payment_claims ADD CONSTRAINT payment_claims_status_check
  CHECK (status IN ('pending', 'confirmed', 'rejected', 'voided'));

CREATE OR REPLACE VIEW customer_balances AS
SELECT
  c.id AS customer_id,
  c.name,
  c.phone_number,
  COALESCE(d.total_due, 0)::numeric(12,2) AS total_due,
  COALESCE(p.total_confirmed, 0)::numeric(12,2) AS total_confirmed,
  (COALESCE(d.total_due, 0) - COALESCE(p.total_confirmed, 0))::numeric(12,2) AS balance
FROM customers c
LEFT JOIN (
  SELECT customer_id, SUM(amount_due) AS total_due
  FROM dues
  WHERE NOT voided
  GROUP BY customer_id
) d ON d.customer_id = c.id
LEFT JOIN (
  SELECT customer_id, SUM(amount_claimed) AS total_confirmed
  FROM payment_claims
  WHERE status = 'confirmed'
  GROUP BY customer_id
) p ON p.customer_id = c.id;
