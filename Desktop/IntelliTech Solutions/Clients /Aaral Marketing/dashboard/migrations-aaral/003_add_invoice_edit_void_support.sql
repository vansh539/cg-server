ALTER TABLE invoices ADD COLUMN voided_at timestamptz;
ALTER TABLE invoices ADD COLUMN voided_by text;
ALTER TABLE invoices ADD COLUMN updated_at timestamptz;
ALTER TABLE invoices ADD COLUMN updated_by text;

-- dues/payment_claims were only ever linked to an invoice by matching the
-- literal "Invoice #N" description string (see ledger.js's old regex join)
-- -- fine for read-only display, not reliable enough to safely edit/void
-- real money. Real FKs going forward.
ALTER TABLE dues ADD COLUMN invoice_id uuid REFERENCES invoices(id);
ALTER TABLE payment_claims ADD COLUMN invoice_id uuid REFERENCES invoices(id);

-- Backfill dues for invoices created before this migration -- the
-- description format has been stable since day one, so this match is exact.
UPDATE dues d
SET invoice_id = i.id
FROM invoices i
WHERE d.description = 'Invoice #' || i.invoice_number
  AND d.invoice_id IS NULL;

-- payment_claims has no equivalent free-text field to backfill from -- a
-- paidNow invoice's claim was never linked to anything, even indirectly, so
-- there is nothing reliable to match against for pre-existing rows. Left
-- NULL on purpose: the app must refuse to edit/void a paid invoice whose
-- claim can't be found this way, rather than guess.
