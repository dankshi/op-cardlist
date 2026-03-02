-- Add grading support for professionally graded cards (PSA, CGC, BGS, TAG)
ALTER TABLE listings ADD COLUMN grading_company TEXT;
ALTER TABLE listings ADD COLUMN grade TEXT;
