-- Request 65 (EPILEPSY): Admin → Column names. For each sheet, the workbook's
-- column an admin picked for a column the pages read (when its name differs),
-- the options each dropdown column allows in the workbook (read with the
-- sheets), and options added in Admin that the platform accepts too.
ALTER TABLE epilepsy_workbook ADD COLUMN column_names_json TEXT;
ALTER TABLE epilepsy_workbook ADD COLUMN lists_json TEXT;
ALTER TABLE epilepsy_workbook ADD COLUMN added_options_json TEXT;
