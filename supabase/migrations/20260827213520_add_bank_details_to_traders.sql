/*
# Add bank_details column to traders table

1. Modified Tables
- `traders` — add `bank_details` (text, nullable) for storing bank transfer
  instructions shown to customers as an alternative to card payment.

2. Notes
- Non-destructive: uses ADD COLUMN IF NOT EXISTS.
- No security changes needed — existing RLS policies already cover the table.
*/

ALTER TABLE traders ADD COLUMN IF NOT EXISTS bank_details text;
