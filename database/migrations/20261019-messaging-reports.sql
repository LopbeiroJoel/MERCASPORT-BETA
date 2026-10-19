-- Une suppression de message ne doit pas fusionner deux signalements ouverts.
-- Le contexte de dédoublonnage reste stable lorsque les FK deviennent NULL.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(621019);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS context_key VARCHAR(80);
UPDATE reports SET context_key=CASE WHEN message_id IS NOT NULL THEN 'message:'||message_id ELSE 'conversation:'||coalesce(conversation_id::text,'deleted:'||id) END WHERE context_key IS NULL;
ALTER TABLE reports ALTER COLUMN context_key SET NOT NULL;
CREATE OR REPLACE FUNCTION messaging_report_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.message_id IS NULL AND NEW.conversation_id IS NULL THEN RAISE EXCEPTION 'Contexte du signalement requis' USING ERRCODE='23514'; END IF;
  NEW.context_key:=CASE WHEN NEW.message_id IS NOT NULL THEN 'message:'||NEW.message_id ELSE 'conversation:'||NEW.conversation_id END;
 ELSE NEW.context_key:=OLD.context_key;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messaging_report_context ON reports;
CREATE TRIGGER messaging_report_context BEFORE INSERT OR UPDATE ON reports FOR EACH ROW EXECUTE FUNCTION messaging_report_context();
CREATE UNIQUE INDEX IF NOT EXISTS reports_context_dedupe_key ON reports(reporter_user_id,context_key,reason_code) WHERE status_code='OPEN';
DROP INDEX IF EXISTS reports_dedupe_key;
COMMIT;
