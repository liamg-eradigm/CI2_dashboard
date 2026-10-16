-- Request 64b (CI SQUARED): an earnings call names its Competitor (one of the
-- Secondary Tracker's Competitors options) instead of a Company.
ALTER TABLE earnings_calls RENAME COLUMN company TO competitor;

-- The Markdown already written: its "Company" heading (the second field, so
-- right after an empty line) becomes "Competitor". Only the first is changed.
UPDATE earnings_calls
   SET markdown = substr(markdown, 1, instr(markdown, char(10) || char(10) || 'Company' || char(10)) - 1)
                  || char(10) || char(10) || 'Competitor' || char(10)
                  || substr(markdown, instr(markdown, char(10) || char(10) || 'Company' || char(10)) + 10)
 WHERE instr(markdown, char(10) || char(10) || 'Company' || char(10)) > 0;
