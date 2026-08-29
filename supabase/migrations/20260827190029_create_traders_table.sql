/*
# Create traders table for Docket subscription & payment link storage

1. New Tables
- `traders` — stores per-trader subscription status and Stripe payment link
- `owner_id` (text, primary key — matches the owner_id used in the jobs table)
- `subscribed` (boolean — whether the trader has an active subscription)
- `subscribed_at` (timestamptz — when they subscribed, nullable)
- `payment_link` (text — the trader's Stripe payment link for customer payments, nullable)

2. Security
- Enable RLS on `traders`.
- Single-tenant app with no sign-in: anon + authenticated CRUD allowed.
- Data is keyed by owner_id (per-device identity).

3. Notes
- The `traders` table is upserted from the frontend using
  `Prefer: resolution=merge-duplicates` on the `owner_id` primary key.
*/

CREATE TABLE IF NOT EXISTS traders (
  owner_id text PRIMARY KEY,
  subscribed boolean NOT NULL DEFAULT false,
  subscribed_at timestamptz,
  payment_link text
);

ALTER TABLE traders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_traders" ON traders;
CREATE POLICY "anon_select_traders" ON traders FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_traders" ON traders;
CREATE POLICY "anon_insert_traders" ON traders FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_traders" ON traders;
CREATE POLICY "anon_update_traders" ON traders FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_traders" ON traders;
CREATE POLICY "anon_delete_traders" ON traders FOR DELETE
  TO anon, authenticated USING (true);
