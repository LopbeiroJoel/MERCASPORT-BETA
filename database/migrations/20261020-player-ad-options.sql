-- Annonces joueurs : tous les postes du catalogue, expérience retirée du formulaire.
-- Les informations déjà enregistrées restent conservées.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(621020);
INSERT INTO sport_qualities(code,label,category,sort_order) VALUES
('LONG_PASSING','Jeu long','TECHNICAL',100),
('THROUGH_BALLS','Passes en profondeur','TECHNICAL',101),
('ONE_TOUCH','Jeu en une touche','TECHNICAL',102),
('HEADING','Jeu de tête','TECHNICAL',103),
('BALL_CARRYING','Conduite de balle','TECHNICAL',104),
('BALL_PROTECTION','Protection du ballon','TECHNICAL',105),
('SET_PIECES','Coups de pied arrêtés','TECHNICAL',106),
('ACCELERATION','Accélération','PHYSICAL',110),
('EXPLOSIVENESS','Explosivité','PHYSICAL',111),
('BALANCE','Équilibre','PHYSICAL',112),
('COORDINATION','Coordination','PHYSICAL',113),
('FLEXIBILITY','Souplesse','PHYSICAL',114),
('REPEAT_SPRINTS','Répétition des sprints','PHYSICAL',115),
('DUELS','Impact dans les duels','PHYSICAL',116),
('OFF_BALL','Déplacements sans ballon','TACTICAL',120),
('SUPPORT_PLAY','Jeu en appui','TACTICAL',121),
('RUNS_BEHIND','Appels en profondeur','TACTICAL',122),
('COVERING','Couverture défensive','TACTICAL',123),
('MARKING','Marquage','TACTICAL',124),
('TRANSITIONS','Gestion des transitions','TACTICAL',125),
('GAME_TEMPO','Gestion du tempo','TACTICAL',126),
('CONCENTRATION','Concentration','MENTAL',130),
('DETERMINATION','Détermination','MENTAL',131),
('RESILIENCE','Persévérance','MENTAL',132),
('COMMUNICATION','Communication','MENTAL',133),
('CONFIDENCE','Confiance en soi','MENTAL',134),
('DECISION_MAKING','Prise de décision','MENTAL',135),
('COMPETITIVENESS','Combativité','MENTAL',136)
ON CONFLICT (code) DO NOTHING;
-- Qualification du helper pour permettre aussi une restauration pg_restore avec search_path vide.
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
 RETURN public.messaging_valid_stats(nullif(value->'sport_stats','null'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION messaging_ad_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a ads; target INTEGER; BEGIN
 IF TG_TABLE_NAME='ads' THEN target:=coalesce(NEW.id,OLD.id); ELSE target:=coalesce(NEW.ad_id,OLD.ad_id); END IF;
 SELECT * INTO a FROM ads WHERE id=target;
 IF NOT FOUND OR a.recruitment_version<2 THEN RETURN NULL; END IF;
 IF (a.announcement_type='CLUB_SEARCH' AND (SELECT count(*) FROM ad_positions WHERE ad_id=target)>3)
 OR (SELECT count(*) FROM ad_qualities WHERE ad_id=target)>(CASE WHEN a.announcement_type='CLUB_SEARCH' THEN 5 ELSE 20 END)
 OR EXISTS(SELECT 1 FROM ad_qualities q JOIN sport_qualities s ON s.code=q.quality_code WHERE q.ad_id=target GROUP BY s.category HAVING count(*)>5)
 OR (SELECT count(*) FROM ad_project_types WHERE ad_id=target)>3 OR (SELECT count(*) FROM ad_conditions WHERE ad_id=target)>3 THEN RAISE EXCEPTION 'Trop de selections' USING ERRCODE='23514'; END IF;
 IF a.announcement_type='PLAYER_SEARCH' AND a.recruitment_version>=3 AND a.status='PUBLISHED' THEN
  IF nullif(btrim(a.title),'') IS NULL OR nullif(btrim(a.description),'') IS NULL OR nullif(btrim(a.city),'') IS NULL OR a.division_code IS NULL OR a.mobility_code IS NULL OR a.availability_code IS NULL
  OR NOT EXISTS(SELECT 1 FROM ad_positions WHERE ad_id=target) OR NOT EXISTS(SELECT 1 FROM ad_project_types WHERE ad_id=target)
  OR nullif(btrim(a.player_details->>'current_club'),'') IS NULL OR nullif(btrim(a.player_details->>'past_clubs'),'') IS NULL THEN RAISE EXCEPTION 'Annonce joueur incomplete' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
COMMIT;
