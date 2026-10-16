-- REPERE ORAL - LES EVOLUTIONS DES ANNONCES APRES LE SCHEMA DE DEPART.
-- Ici une equipe devient facultative ; l'auteur et le club doivent quand meme etre coherents.
-- ads garde les champs simples. ad_positions relie une annonce a plusieurs codes de postes.
-- La vue est refaite avec LEFT JOIN pour garder aussi les annonces sans equipe.
-- C'est cette migration qui explique pourquoi schema.sql seul ne decrit plus tout le modele actuel.

-- ANNONCE-02 : annonces de recrutement avec plusieurs postes.
-- Conserver les annonces et les relations existantes.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Ajouter les informations manquantes.
ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS department VARCHAR(20)
    CHECK (department IN (
      'Bas-Rhin',
      'Haut-Rhin',
      'Moselle',
      'Meurthe-et-Moselle',
      'Meuse',
      'Vosges'
    )),

  ADD COLUMN IF NOT EXISTS division_code VARCHAR(20)
    REFERENCES public.divisions(code),

  ADD COLUMN IF NOT EXISTS age_range VARCHAR(20)
    CHECK (age_range IN (
      'UNDER_18',
      '18_25',
      '26_35',
      '36_PLUS',
      'ANY'
    )),

  ADD COLUMN IF NOT EXISTS experience_level VARCHAR(20)
    CHECK (experience_level IN (
      'BEGINNER',
      'DEPARTMENTAL',
      'REGIONAL',
      'NATIONAL',
      'ANY'
    )),

  ADD COLUMN IF NOT EXISTS trial_possible BOOLEAN,

  ADD COLUMN IF NOT EXISTS additional_info TEXT;

-- Relier chaque annonce à un ou plusieurs postes.
-- Relation plusieurs-a-plusieurs : une annonce peut avoir plusieurs postes, et un poste servir a plusieurs annonces.
-- La paire ad_id + position_code est unique. Ce n'est pas la meme structure que le TEXT[] du profil joueur.
CREATE TABLE IF NOT EXISTS public.ad_positions (
  ad_id INTEGER NOT NULL
    REFERENCES public.ads(id) ON DELETE CASCADE,

  position_code VARCHAR(50) NOT NULL
    REFERENCES public.positions(code) ON DELETE RESTRICT,

  PRIMARY KEY (ad_id, position_code)
);

-- Une annonce peut appartenir directement à un club.
ALTER TABLE public.ads
  -- C'est ici que l'annonce sans equipe devient possible ; le schema de depart la refusait.
  ALTER COLUMN team_id DROP NOT NULL;

-- Récupérer les divisions connues des anciennes annonces.
UPDATE public.ads a
SET division_code = t.division
FROM public.teams t
JOIN public.divisions d ON d.code = t.division
WHERE a.team_id = t.id
  AND a.division_code IS NULL;

-- Vérifier que le club ou l'équipe appartient à l'auteur.
-- Je remplace l'ancienne fonction : l'auteur joueur/club doit etre coherent meme sans team_id.
CREATE OR REPLACE FUNCTION public.check_ad_club()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  author_role TEXT;
  owning_club INTEGER;
  club_account INTEGER;
  club_city TEXT;
BEGIN
  SELECT upper(role)
  INTO author_role
  FROM public.users
  WHERE id = NEW.author_id;

  IF author_role IS NULL
     OR author_role NOT IN ('PLAYER', 'CLUB') THEN
    RAISE EXCEPTION 'Un auteur joueur ou club est obligatoire.';
  END IF;

  -- Conserver le fonctionnement des annonces joueurs.
  IF author_role = 'PLAYER' THEN
    IF NEW.team_id IS NOT NULL OR NEW.club_id IS NOT NULL THEN
      RAISE EXCEPTION 'Une annonce joueur ne peut pas être liée à un club.';
    END IF;

    NEW.city := COALESCE(NEW.city, NEW.location);
    RETURN NEW;
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    SELECT c.id, c.user_id, c.city
    INTO owning_club, club_account, club_city
    FROM public.teams t
    JOIN public.clubs c ON c.id = t.club_id
    WHERE t.id = NEW.team_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Équipe introuvable.';
    END IF;

    IF NEW.club_id IS NOT NULL
       AND NEW.club_id <> owning_club THEN
      RAISE EXCEPTION 'Le club ne correspond pas à l’équipe.';
    END IF;
  ELSE
    SELECT c.id, c.user_id, c.city
    INTO owning_club, club_account, club_city
    FROM public.clubs c
    WHERE c.id = NEW.club_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Un club existant est obligatoire.';
    END IF;
  END IF;

  IF club_account IS DISTINCT FROM NEW.author_id THEN
    RAISE EXCEPTION 'Ce club n’appartient pas au compte auteur.';
  END IF;

  NEW.club_id := owning_club;
  NEW.city := COALESCE(NEW.city, NEW.location, club_city);

  RETURN NEW;
END;
$$;

-- Refuser une conversion si un ancien poste est inconnu.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ads a
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.ad_positions ap
      WHERE ap.ad_id = a.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.positions p
      WHERE lower(p.label) = lower(trim(a.position))
         OR p.code = upper(trim(a.position))
         OR (
           lower(trim(a.position)) = 'avant-centre'
           AND p.code = 'STRIKER'
         )
    )
  ) THEN
    RAISE EXCEPTION 'Un ancien poste est inconnu : vérifier les correspondances.';
  END IF;
END;
$$;

-- Associer les anciennes annonces à leurs postes.
INSERT INTO public.ad_positions (ad_id, position_code)
SELECT a.id, p.code
FROM public.ads a
JOIN public.positions p
  ON lower(p.label) = lower(trim(a.position))
  OR p.code = upper(trim(a.position))
  OR (
    lower(trim(a.position)) = 'avant-centre'
    AND p.code = 'STRIKER'
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ad_positions ap
  WHERE ap.ad_id = a.id
)
ON CONFLICT (ad_id, position_code) DO NOTHING;

-- Rassembler les informations utilisées par les lectures d'annonces.
-- Conserver l'ordre des anciennes colonnes de la vue.
-- Version actuelle de la vue : je garde les anciennes colonnes et j'ajoute les nouvelles infos pour ne pas casser les lectures.
CREATE OR REPLACE VIEW public.ads_details AS
SELECT
  a.id,
  c.id AS club_id,
  c.name AS club_name,
  a.title,
  a.position,
  a.city,
  a.description,
  a.created_at,
  a.team_id,
  t.name AS team_name,
  COALESCE(a.division_code, t.division) AS division,
  a.short_description,
  a.preferred_foot,
  a.requirements,
  a.contract,
  a.work_time,
  a.salary,
  a.location,
  a.missions,
  a.author_id,
  u.username AS author_name,
  upper(u.role) AS author_role,

  ARRAY(
    SELECT p.code::TEXT
    FROM public.ad_positions ap
    JOIN public.positions p ON p.code = ap.position_code
    WHERE ap.ad_id = a.id
    ORDER BY p.sort_order
  ) AS positions,

  a.department,
  a.age_range,
  a.experience_level,
  a.trial_possible,
  a.additional_info

FROM public.ads a
-- LEFT JOIN garde aussi l'annonce qui n'a pas d'equipe ; INNER JOIN aurait fait disparaitre cette ligne.
LEFT JOIN public.teams t ON t.id = a.team_id
LEFT JOIN public.clubs c
  ON c.id = COALESCE(a.club_id, t.club_id)
LEFT JOIN public.users u ON u.id = a.author_id;

COMMIT;