-- Nouveaux champs publics d’une annonce joueur : le CV privé reste indépendant.
-- Les anciennes annonces restent intactes ; seules les publications version 3 exigent ces champs.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(621020);
INSERT INTO module_migrations(version,previous) VALUES('20261020-player-ad-fields',jsonb_build_object('ad_limits',pg_get_functiondef('messaging_ad_limits()'::regprocedure))) ON CONFLICT DO NOTHING;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS player_details JSONB NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION player_ad_details_valid(value JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k TEXT; limit_value INTEGER; BEGIN
 IF jsonb_typeof(value)<>'object' THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(value) e WHERE e NOT IN ('current_club','past_clubs','experience','age','height_cm','sport_stats','sport_season')) THEN RETURN FALSE; END IF;
 FOREACH k IN ARRAY ARRAY['current_club','past_clubs','experience'] LOOP
  limit_value:=CASE WHEN k='current_club' THEN 150 ELSE 2000 END;
  IF value?k AND value->k<>'null'::jsonb AND (jsonb_typeof(value->k)<>'string' OR length(value->>k)>limit_value) THEN RETURN FALSE; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['age','height_cm'] LOOP
  IF value?k AND value->k<>'null'::jsonb THEN
   IF jsonb_typeof(value->k)<>'number' OR value->>k !~ '^[0-9]{1,3}$' THEN RETURN FALSE; END IF;
   IF (k='age' AND (value->>k)::int NOT BETWEEN 5 AND 100) OR (k='height_cm' AND (value->>k)::int NOT BETWEEN 80 AND 250) THEN RETURN FALSE; END IF;
  END IF;
 END LOOP;
 IF value?'sport_season' AND value->'sport_season'<>'null'::jsonb AND (jsonb_typeof(value->'sport_season')<>'string' OR value->>'sport_season' !~ '^\d{4}/\d{4}$') THEN RETURN FALSE; END IF;
 RETURN messaging_valid_stats(nullif(value->'sport_stats','null'::jsonb));
END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ads_player_details_check') THEN ALTER TABLE ads ADD CONSTRAINT ads_player_details_check CHECK(player_ad_details_valid(player_details)); END IF; END $$;
CREATE OR REPLACE FUNCTION messaging_ad_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a ads; target INTEGER; BEGIN
 IF TG_TABLE_NAME='ads' THEN target:=coalesce(NEW.id,OLD.id); ELSE target:=coalesce(NEW.ad_id,OLD.ad_id); END IF;
 SELECT * INTO a FROM ads WHERE id=target;
 IF NOT FOUND OR a.recruitment_version<2 THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM ad_positions WHERE ad_id=target)>(CASE WHEN a.announcement_type='CLUB_SEARCH' THEN 3 ELSE 2 END)
 OR (SELECT count(*) FROM ad_qualities WHERE ad_id=target)>(CASE WHEN a.announcement_type='CLUB_SEARCH' THEN 5 ELSE 20 END)
 OR EXISTS(SELECT 1 FROM ad_qualities q JOIN sport_qualities s ON s.code=q.quality_code WHERE q.ad_id=target GROUP BY s.category HAVING count(*)>5)
 OR (SELECT count(*) FROM ad_project_types WHERE ad_id=target)>3 OR (SELECT count(*) FROM ad_conditions WHERE ad_id=target)>3 THEN RAISE EXCEPTION 'Trop de selections' USING ERRCODE='23514'; END IF;
 IF a.announcement_type='PLAYER_SEARCH' AND a.recruitment_version>=3 AND a.status='PUBLISHED' THEN
  IF nullif(btrim(a.title),'') IS NULL OR nullif(btrim(a.description),'') IS NULL OR nullif(btrim(a.city),'') IS NULL OR a.division_code IS NULL OR a.mobility_code IS NULL OR a.availability_code IS NULL
  OR NOT EXISTS(SELECT 1 FROM ad_positions WHERE ad_id=target) OR NOT EXISTS(SELECT 1 FROM ad_project_types WHERE ad_id=target)
  OR nullif(btrim(a.player_details->>'current_club'),'') IS NULL OR nullif(btrim(a.player_details->>'past_clubs'),'') IS NULL OR nullif(btrim(a.player_details->>'experience'),'') IS NULL THEN RAISE EXCEPTION 'Annonce joueur incomplete' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
COMMIT;
