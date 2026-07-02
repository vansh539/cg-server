CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone_number text NOT NULL UNIQUE,
  cokarma_membership_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dues_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  imported_by text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0
);

CREATE TABLE dues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  description text NOT NULL,
  amount_due numeric(12,2) NOT NULL,
  due_date date,
  import_batch_id uuid REFERENCES dues_imports(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  amount_claimed numeric(12,2) NOT NULL,
  proof_type text NOT NULL CHECK (proof_type IN ('screenshot', 'utr_text', 'cash')),
  proof_reference text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  reported_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text
);

CREATE TABLE admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- customer_balances aggregates dues and payment_claims in separate subqueries
-- before joining. Joining the two one-to-many tables directly (dues and
-- payment_claims both joined straight to customers) would fan out into a
-- cross product per customer — e.g. 2 dues rows x 3 confirmed claims rows
-- = 6 joined rows — silently inflating both SUM()s. Subqueries pre-aggregate
-- each table to one row per customer before the join, so this can't happen.
CREATE VIEW customer_balances AS
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
  GROUP BY customer_id
) d ON d.customer_id = c.id
LEFT JOIN (
  SELECT customer_id, SUM(amount_claimed) AS total_confirmed
  FROM payment_claims
  WHERE status = 'confirmed'
  GROUP BY customer_id
) p ON p.customer_id = c.id;
