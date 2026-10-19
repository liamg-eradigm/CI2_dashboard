-- Request 67 (EPILEPSY): Admin → Table columns. Each table's columns in the
-- order an admin set (News Primary and Secondary, RCA, Trial Tracker).
ALTER TABLE epilepsy_workbook ADD COLUMN column_order_json TEXT;
