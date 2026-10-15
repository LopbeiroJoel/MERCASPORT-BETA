-- Permettre les candidatures aux annonces de clubs sans équipe.
-- Conserver le contrôle du profil joueur et refuser les annonces masquées.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.check_application() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE player_name TEXT; player_email TEXT;
BEGIN
  IF NEW.player_id IS NOT NULL THEN
    SELECT u.name, u.email INTO player_name, player_email
    FROM public.players p JOIN public.users u ON u.id = p.user_id
    WHERE p.id = NEW.player_id AND upper(u.role) = 'PLAYER'
    FOR SHARE OF p, u;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Le profil doit appartenir a un joueur.' USING ERRCODE = '23514';
    END IF;
    NEW.name := coalesce(NEW.name, player_name);
    NEW.email := coalesce(NEW.email, player_email);
  END IF;

  PERFORM 1 FROM public.ads a
  WHERE a.id = NEW.ad_id AND a.status = 'PUBLISHED'
    AND NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = a.author_id AND u.status IN ('BANNED', 'DISABLED')
    )
  FOR SHARE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Une candidature exige une annonce disponible.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
