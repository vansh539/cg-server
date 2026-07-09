CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number serial UNIQUE,
  customer_id uuid REFERENCES customers(id),
  paid_now boolean NOT NULL DEFAULT true,
  unloading_charge numeric(12,2),
  subtotal numeric(12,2) NOT NULL,
  total numeric(12,2) NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  s_no integer NOT NULL,
  particulars text NOT NULL,
  grade text,
  vch text,
  qty numeric(12,2) NOT NULL,
  rate numeric(12,2) NOT NULL,
  amount numeric(12,2) NOT NULL
);
