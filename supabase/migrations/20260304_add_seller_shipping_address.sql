-- Add shipping address fields to profiles for seller ship-from address
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shipping_street1 TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shipping_city TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shipping_state TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS shipping_zip TEXT;
