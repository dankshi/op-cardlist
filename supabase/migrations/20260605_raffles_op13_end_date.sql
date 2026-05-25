-- Set the OP13 launch raffle draw date. Split from the table-creation
-- migration so the date can be adjusted by adding another UPDATE
-- migration later, without re-running the whole bootstrap.
UPDATE raffles
SET ends_at = '2026-06-30 23:59:59-07'
WHERE slug = 'op13-launch' AND ends_at IS NULL;
