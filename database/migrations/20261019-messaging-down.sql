-- Retour arrière protégé : refus de perdre les nouvelles annonces, fiches ou discussions.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(621019);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM conversations) OR EXISTS(SELECT 1 FROM ads WHERE recruitment_version=2)
 OR EXISTS(SELECT 1 FROM applications WHERE player_user_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM player_profiles WHERE sport_profile_version=2)
 OR EXISTS(SELECT 1 FROM reports) THEN
  RAISE EXCEPTION 'Retour arriere refuse : exporter les nouvelles donnees et revenir avec une migration de conservation.';
 END IF;
END $$;
DO $$ DECLARE old JSONB; c JSONB; BEGIN
 SELECT previous INTO STRICT old FROM module_migrations WHERE version='20261019-messaging';
 EXECUTE old->>'check_ad_club'; EXECUTE old->>'check_application';
 ALTER TABLE ads DROP CONSTRAINT ads_recruitment_status_fk;
 FOR c IN SELECT * FROM jsonb_array_elements(old->'status_constraints') LOOP
  EXECUTE format('ALTER TABLE ads ADD CONSTRAINT %I %s',c->>'name',c->>'definition');
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS messaging_ad_limits ON ads;
DROP TRIGGER IF EXISTS messaging_lock_ad ON ad_positions;
DROP TRIGGER IF EXISTS messaging_ad_limits ON ad_positions;
DROP TRIGGER IF EXISTS messaging_application_history ON applications;
DROP TABLE reports,notifications,messages,conversation_participants,conversations,application_status_history,recruitment_audit;
DROP TABLE ad_qualities,ad_project_types,ad_conditions,player_sport_qualities,club_memberships;
ALTER TABLE ads DROP COLUMN recruitment_version,DROP COLUMN announcement_type,DROP COLUMN sport_code,DROP COLUMN availability_code,DROP COLUMN mobility_code,DROP COLUMN category_code,DROP COLUMN recruitment_type_code,DROP COLUMN primary_position,DROP COLUMN published_at,DROP COLUMN expires_at,DROP COLUMN updated_at;
ALTER TABLE applications DROP COLUMN player_user_id,DROP COLUMN club_id,DROP COLUMN status_code,DROP COLUMN updated_at,DROP COLUMN withdrawn_at;
ALTER TABLE player_profiles DROP COLUMN sport_code,DROP COLUMN availability_code,DROP COLUMN sport_city,DROP COLUMN sport_stats,DROP COLUMN sport_season,DROP COLUMN is_public,DROP COLUMN sport_profile_version;
DROP FUNCTION messaging_ad_limits(),messaging_lock_ad(),messaging_lock_profile(),messaging_profile_limits(),messaging_valid_stats(JSONB),messaging_two_participants(),messaging_participant_check(),messaging_message_check(),messaging_application_history(),messaging_manages_club(INTEGER,INTEGER);
DROP TABLE sports,availability_options,mobility_options,sport_categories,project_types,recruitment_types,recruitment_conditions,announcement_types,announcement_statuses,application_statuses,notification_types,report_reasons,report_statuses,sport_qualities,preferred_feet;
DROP FUNCTION IF EXISTS messaging_report_context();
DELETE FROM module_migrations WHERE version='20261019-messaging';
COMMIT;
