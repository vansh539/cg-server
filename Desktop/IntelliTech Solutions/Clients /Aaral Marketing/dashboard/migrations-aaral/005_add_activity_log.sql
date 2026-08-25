-- Personnel Tracking: an audit trail of who did what, so a mistake made in
-- the ledger can be traced back to a specific employee instead of "someone,
-- at some point." user_id is nullable + ON DELETE SET NULL because a user
-- can be deactivated (or, in principle, removed) without losing the
-- historical record of what they did -- username/display_name are captured
-- as plain text at write time for that reason.
CREATE TABLE activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES dashboard_users(id) ON DELETE SET NULL,
  username text NOT NULL,
  display_name text NOT NULL,
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_log_created_at_idx ON activity_log (created_at DESC);
