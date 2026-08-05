-- Replaces the shared Admin PIN with real per-user accounts (2 admin, 2
-- employee) so destructive/updates actions are tied to a specific person,
-- not a PIN anyone on shift could type in.
CREATE TABLE dashboard_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'employee')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
