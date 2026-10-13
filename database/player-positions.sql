-- Phase 1 : ajouter et convertir sans casser le backend encore deploye.
-- Apres le deploiement du nouveau code, executer player-positions-cleanup.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.player_profiles DROP CONSTRAINT IF EXISTS player_profiles_positions_check;
ALTER TABLE public.player_profiles ADD COLUMN IF NOT EXISTS positions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE public.player_profiles SET positions = ARRAY[]::TEXT[] WHERE positions IS NULL;
ALTER TABLE public.player_profiles ALTER COLUMN positions SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE public.player_profiles ALTER COLUMN positions SET NOT NULL;

CREATE OR REPLACE FUNCTION public.valid_player_positions(p TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    cardinality(p) <= 14
    AND COALESCE(array_ndims(p), 1) = 1
    AND array_position(p, NULL) IS NULL
    AND p <@ ARRAY['GOALKEEPER','CENTRE_BACK','RIGHT_BACK','LEFT_BACK',
      'RIGHT_WING_BACK','LEFT_WING_BACK','DEFENSIVE_MIDFIELDER',
      'CENTRAL_MIDFIELDER','ATTACKING_MIDFIELDER','RIGHT_MIDFIELDER',
      'LEFT_MIDFIELDER','RIGHT_WINGER','LEFT_WINGER','STRIKER']::TEXT[]
    AND cardinality(p) = (SELECT count(DISTINCT value) FROM unnest(p) AS value), FALSE);
$$;

-- Les deux anciens postes deviennent un seul Buteur, sans doublon.
UPDATE public.player_profiles AS profile
SET positions = ARRAY(
  SELECT code FROM (
    SELECT CASE WHEN value IN ('SECOND_STRIKER', 'CENTRE_FORWARD')
      THEN 'STRIKER' ELSE value END AS code, min(ordinality) AS first_position
    FROM unnest(profile.positions) WITH ORDINALITY AS selected(value, ordinality)
    GROUP BY CASE WHEN value IN ('SECOND_STRIKER', 'CENTRE_FORWARD')
      THEN 'STRIKER' ELSE value END
  ) AS converted ORDER BY first_position
)
WHERE positions && ARRAY['SECOND_STRIKER', 'CENTRE_FORWARD']::TEXT[];

CREATE TEMP TABLE legacy_position_map(label TEXT PRIMARY KEY, code TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO legacy_position_map VALUES
('goalkeeper','GOALKEEPER'),('gardien','GOALKEEPER'),('gardien de but','GOALKEEPER'),('gk','GOALKEEPER'),
('centre_back','CENTRE_BACK'),('defenseur central','CENTRE_BACK'),('dc','CENTRE_BACK'),
('right_back','RIGHT_BACK'),('lateral droit','RIGHT_BACK'),('arriere droit','RIGHT_BACK'),
('left_back','LEFT_BACK'),('lateral gauche','LEFT_BACK'),('arriere gauche','LEFT_BACK'),
('right_wing_back','RIGHT_WING_BACK'),('piston droit','RIGHT_WING_BACK'),
('left_wing_back','LEFT_WING_BACK'),('piston gauche','LEFT_WING_BACK'),
('defensive_midfielder','DEFENSIVE_MIDFIELDER'),('milieu defensif','DEFENSIVE_MIDFIELDER'),
('central_midfielder','CENTRAL_MIDFIELDER'),('milieu central','CENTRAL_MIDFIELDER'),
('attacking_midfielder','ATTACKING_MIDFIELDER'),('milieu offensif','ATTACKING_MIDFIELDER'),
('right_midfielder','RIGHT_MIDFIELDER'),('milieu droit','RIGHT_MIDFIELDER'),
('left_midfielder','LEFT_MIDFIELDER'),('milieu gauche','LEFT_MIDFIELDER'),
('right_winger','RIGHT_WINGER'),('ailier droit','RIGHT_WINGER'),
('left_winger','LEFT_WINGER'),('ailier gauche','LEFT_WINGER'),
('second_striker','STRIKER'),('second attaquant','STRIKER'),('attaquant de soutien','STRIKER'),
('centre_forward','STRIKER'),('avant-centre','STRIKER'),('avant centre','STRIKER'),
('buteur','STRIKER'),('striker','STRIKER');

DO $$
DECLARE old_profile RECORD; converted TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='player_profiles' AND column_name='position') THEN
    FOR old_profile IN EXECUTE 'SELECT user_id, position FROM public.player_profiles WHERE NULLIF(btrim(position), '''') IS NOT NULL' LOOP
      SELECT code INTO converted FROM legacy_position_map
      WHERE label = translate(lower(btrim(old_profile.position)), 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ancien poste non reconnu pour le compte %. Migration annulee : completer la correspondance avant de recommencer.', old_profile.user_id;
      END IF;
      UPDATE public.player_profiles SET positions = array_append(positions, converted)
      WHERE user_id=old_profile.user_id AND NOT converted = ANY(positions);
    END LOOP;
  END IF;
END $$;
ALTER TABLE public.player_profiles DROP CONSTRAINT IF EXISTS player_profiles_positions_check;
ALTER TABLE public.player_profiles ADD CONSTRAINT player_profiles_positions_check CHECK (public.valid_player_positions(positions));
COMMIT;
