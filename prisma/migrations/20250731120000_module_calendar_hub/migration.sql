-- Product module: calendar_hub (Unified Calendar & Conversation Hub)
-- D1 stores ModuleId as TEXT — no Postgres ENUM alter required.
-- Enable per rooftop via DealershipModule / Manager Dashboard → Modules.

-- No structural DDL change; module id is application-level.
-- Optional seed for staging rooftop (safe if re-run fails uniqueness — use app seed helpers).
SELECT 1;
