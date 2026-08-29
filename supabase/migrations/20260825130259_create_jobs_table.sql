/*
# Create jobs table for Docket app (single-tenant, no auth)

1. New Tables
- `jobs` — stores quotes/invoices for a trader
- `id` (text, primary key — client-generated unique string)
- `number` (int — sequential job/quote number, nullable for drafts)
- `owner_id` (text — identifies the trader's device/session)
- `customer` (text — customer name)
- `phone` (text — customer phone, nullable)
- `dial_code` (text — international dial code, e.g. "44")
- `job_desc` (text — short job description)
- `lines` (jsonb — array of line items: {id, desc, qty, price})
- `vat_registered` (boolean — whether to add 20% VAT)
- `status` (text — one of: draft, sent, approved, paid)
- `created_at` (date — ISO date string)
- `sent_at` (date — when quote was sent, nullable)
- `approved_at` (date — when customer approved, nullable)
- `due_date` (date — invoice due date, nullable)
- `paid_at` (date — when marked paid, nullable)

2. Security
- Enable RLS on `jobs`.
- This is a single-tenant app with no sign-in screen. The anon-key frontend
  needs full CRUD access, so policies use `TO anon, authenticated`.
- Data is intentionally shared/public within this app (no user accounts).

3. Indexes
- Index on `owner_id` for fast lookup of a trader's jobs.
- Index on `id` (already primary key).
*/

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  number int,
  owner_id text NOT NULL,
  customer text NOT NULL DEFAULT '',
  phone text DEFAULT '',
  dial_code text DEFAULT '44',
  job_desc text DEFAULT '',
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  vat_registered boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  created_at date DEFAULT CURRENT_DATE,
  sent_at date,
  approved_at date,
  due_date date,
  paid_at date
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_jobs" ON jobs;
CREATE POLICY "anon_select_jobs" ON jobs FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_jobs" ON jobs;
CREATE POLICY "anon_insert_jobs" ON jobs FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_jobs" ON jobs;
CREATE POLICY "anon_update_jobs" ON jobs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_jobs" ON jobs;
CREATE POLICY "anon_delete_jobs" ON jobs FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_jobs_owner_id ON jobs (owner_id);
CREATE INDEX IF NOT EXISTS idx_jobs_number ON jobs (number);
