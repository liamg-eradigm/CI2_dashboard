-- Request 63: CI SQUARED's Test tab (request 55) is gone. Its test spaces
-- are switched off (no one can open them; their rows stay, unreachable), and
-- the record of the workbook sync behind them is dropped.
UPDATE tenants SET active = 0 WHERE kind = 'test';
DROP TABLE IF EXISTS excel_sync;
