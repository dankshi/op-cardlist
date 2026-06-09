-- Optional serial number for a collection line (serialized / numbered cards,
-- e.g. "012/100"). Serialized will become its own card type later (like manga);
-- for now it's a free annotation a collector can record on any holding.
alter table collections
  add column if not exists serial_number text;
