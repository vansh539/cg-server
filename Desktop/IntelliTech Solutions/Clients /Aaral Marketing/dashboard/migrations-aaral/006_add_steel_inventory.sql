-- Iron & Steel: a second inventory book alongside cement, for a client who
-- doesn't hold steel stock yet but wants the system in place before they do.
-- Ported from a sibling client's tool (Narayani Steels), which ran this same
-- model as append-only JSON files -- rebuilt here on Postgres so it's covered
-- by the nightly backup and the ledger's own schema_migrations gate, rather
-- than living in a data file inside the app directory that a routine
-- `git reset --hard` rollback would silently wipe.
--
-- steel_movements is the source of truth (every stock-in, sale-deduction and
-- correction is one row, never edited in place); steel_items.current_stock_kg
-- / stock_pcs are a cache of that ledger for fast reads, kept in step by the
-- application layer inside one transaction per write -- never written to
-- directly outside src/steelStore.js.

CREATE TABLE steel_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE steel_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES steel_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  -- 'kg': tracked quantity is a weight. 'pcs': tracked quantity is a piece
  -- count with no weight concept at all (e.g. a covering block).
  unit text NOT NULL CHECK (unit IN ('kg', 'pcs')),
  -- Only meaningful for unit='kg': lets the UI derive an approximate piece
  -- count from the weight on hand. Null means that derivation isn't offered.
  weight_per_piece_kg numeric(12,3),
  -- An item can track pieces *alongside* its kg total (e.g. TMT bars, sold
  -- by weight but counted by bundle) -- dual_track turns stock_pcs on as a
  -- second, independently-moved counter rather than a derived value.
  dual_track boolean NOT NULL DEFAULT false,
  current_stock_kg numeric(14,3) NOT NULL DEFAULT 0,
  stock_pcs numeric(14,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX steel_items_category_id_idx ON steel_items (category_id);

CREATE TABLE steel_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES steel_items(id) ON DELETE CASCADE,
  delta_kg numeric(14,3) NOT NULL,
  delta_pcs numeric(14,3),
  -- 'initial' (seeded on item creation) and 'stock-in' are both "came in";
  -- kept as separate reasons anyway (rather than folding initial into
  -- stock-in) because a report needs to tell "opening stock this item was
  -- created with" apart from "delivered during the period" if that
  -- distinction is ever wanted later, and it costs nothing to keep now.
  reason text NOT NULL CHECK (reason IN ('initial', 'stock-in', 'invoice-deduct', 'adjustment')),
  note text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX steel_movements_item_id_idx ON steel_movements (item_id);
CREATE INDEX steel_movements_occurred_at_idx ON steel_movements (occurred_at);

-- A blank category list makes the Add Item form the first thing anyone has
-- to fight with. Seeded once here rather than by application code on boot,
-- so it happens exactly once, deterministically, the same way the rest of
-- this app's fixed data is seeded through migrations.
INSERT INTO steel_categories (name) VALUES
  ('M.S. Pipes'), ('TMT Bars'), ('M.S. Section'), ('Colour Coated Sheets'), ('Rings')
ON CONFLICT (name) DO NOTHING;
