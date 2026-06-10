-- Grading cert number for slabbed collection lines (e.g. Beckett "0011590232").
-- Variant-level, like serial_number / custom_value; only meaningful for graded
-- lines. Surfaced on the digital slab and editable in the collection editor.
alter table collections
  add column if not exists cert_number text;
