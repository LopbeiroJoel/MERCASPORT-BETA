-- REPERE ORAL - LES CHAMPS SUPPLEMENTAIRES DU PROFIL.
-- Les infos communes vont dans users ; le parcours/niveau dans player_profiles ; le descriptif club dans club_profiles.
-- visible=false par defaut : pas d'accord d'affichage public par defaut. Le proprietaire voit quand meme son profil prive.

BEGIN;
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS photo_url TEXT,
    ADD COLUMN IF NOT EXISTS biography TEXT,
    ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
    ADD COLUMN IF NOT EXISTS location VARCHAR(100),
    -- Un booleen est true/false. Les trois choix de visibilite demarrent a false.
    ADD COLUMN IF NOT EXISTS email_visible BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS phone_visible BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS location_visible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.player_profiles
    ADD COLUMN IF NOT EXISTS past_clubs TEXT,
    ADD COLUMN IF NOT EXISTS experience TEXT,
    ADD COLUMN IF NOT EXISTS level VARCHAR(100);
ALTER TABLE public.club_profiles
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS general_info TEXT;
COMMIT;
