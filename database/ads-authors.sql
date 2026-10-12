-- Conserver les changements realises dans Neon pour les annonces joueur/club.
-- Base neuve : schema, seed facultatif, registration, puis cette migration.
BEGIN;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS author_id INTEGER REFERENCES public.users(id);
UPDATE public.ads a SET author_id = c.user_id
FROM public.clubs c JOIN public.users u ON u.id = c.user_id
WHERE a.club_id = c.id AND a.author_id IS NULL AND UPPER(u.role) = 'CLUB';
ALTER TABLE public.ads ALTER COLUMN team_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.check_ad_club()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    author_role TEXT;
    owning_club INTEGER;
    club_account INTEGER;
    club_city TEXT;
BEGIN
    SELECT UPPER(role) INTO author_role FROM public.users WHERE id = NEW.author_id;
    IF author_role IS NULL OR author_role NOT IN ('PLAYER', 'CLUB') THEN
        RAISE EXCEPTION 'Un auteur joueur ou club est obligatoire.';
    END IF;
    IF author_role = 'PLAYER' THEN
        IF NEW.team_id IS NOT NULL OR NEW.club_id IS NOT NULL THEN
            RAISE EXCEPTION 'Une annonce joueur ne doit pas avoir d equipe ou de club associe.';
        END IF;
        NEW.city := NEW.location;
        RETURN NEW;
    END IF;
    SELECT c.id, c.user_id, c.city INTO owning_club, club_account, club_city
    FROM public.teams t JOIN public.clubs c ON c.id = t.club_id WHERE t.id = NEW.team_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Une equipe existante est obligatoire pour une annonce club.';
    END IF;
    IF club_account IS DISTINCT FROM NEW.author_id THEN
        RAISE EXCEPTION 'Cette equipe n appartient pas au compte auteur.';
    END IF;
    IF NEW.club_id IS NOT NULL AND NEW.club_id <> owning_club THEN
        RAISE EXCEPTION 'Le club ne correspond pas a celui de l equipe.';
    END IF;
    NEW.club_id := owning_club;
    NEW.city := COALESCE(NEW.location, club_city);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW public.ads_details AS
SELECT a.id, c.id AS club_id, c.name AS club_name, a.title, a.position, a.city,
       a.description, a.created_at, a.team_id, t.name AS team_name, t.division,
       a.short_description, a.preferred_foot, a.requirements, a.contract,
       a.work_time, a.salary, a.location, a.missions,
       a.author_id, u.username AS author_name, UPPER(u.role) AS author_role
FROM public.ads a
LEFT JOIN public.teams t ON t.id = a.team_id
LEFT JOIN public.clubs c ON c.id = t.club_id
LEFT JOIN public.users u ON u.id = a.author_id;
COMMIT;
