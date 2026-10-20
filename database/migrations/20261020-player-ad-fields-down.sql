BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(621020);
DO $$ DECLARE previous_function TEXT; BEGIN
 IF EXISTS(SELECT 1 FROM ads WHERE recruitment_version>=3 OR player_details<>'{}'::jsonb) THEN RAISE EXCEPTION 'Retour arriere refuse : les nouvelles annonces contiennent des informations joueur.'; END IF;
 SELECT previous->>'ad_limits' INTO STRICT previous_function FROM module_migrations WHERE version='20261020-player-ad-fields';
 EXECUTE previous_function;
END $$;
ALTER TABLE ads DROP COLUMN player_details;
DROP FUNCTION player_ad_details_valid(JSONB);
DELETE FROM module_migrations WHERE version='20261020-player-ad-fields';
COMMIT;
