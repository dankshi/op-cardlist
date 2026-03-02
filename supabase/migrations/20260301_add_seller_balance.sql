-- Add balance column to profiles for seller credit system
-- Credits are 1:1 USD, incremented when orders are paid
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS balance NUMERIC(10,2) NOT NULL DEFAULT 0;
