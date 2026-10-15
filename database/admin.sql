-- Tables et champs nécessaires au panel administrateur.
BEGIN;

SET LOCAL lock_timeout = '5s';

-- Droits administratifs, séparés du rôle joueur ou club.
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id),
  role VARCHAR(20) NOT NULL
    CHECK (role = 'ADMIN'),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Informations de bannissement.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ban_reason TEXT,
  ADD COLUMN IF NOT EXISTS status_before_ban VARCHAR(20);

-- Relier les annonces a leur compte auteur sur une installation neuve.
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS author_id INTEGER REFERENCES public.users(id);
UPDATE public.ads a SET author_id = c.user_id
FROM public.clubs c
WHERE a.club_id = c.id AND a.author_id IS NULL AND c.user_id IS NOT NULL;

-- Suppression logique des annonces.
ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS status VARCHAR(20)
    NOT NULL DEFAULT 'PUBLISHED'
    CHECK (status IN ('PUBLISHED', 'DELETED')),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- Historique des sanctions et des changements de droits.
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  admin_user_id INTEGER NOT NULL
    REFERENCES public.users(id),

  action VARCHAR(30) NOT NULL
    CHECK (action IN (
      'BAN_USER',
      'UNBAN_USER',
      'DELETE_AD',
      'GRANT_ADMIN',
      'REVOKE_ADMIN'
    )),

  target_user_id INTEGER REFERENCES public.users(id),
  target_ad_id INTEGER REFERENCES public.ads(id),

  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (
    (
      action = 'DELETE_AD'
      AND target_ad_id IS NOT NULL
      AND target_user_id IS NULL
    )
    OR
    (
      action <> 'DELETE_AD'
      AND target_user_id IS NOT NULL
      AND target_ad_id IS NULL
    )
  )
);

-- Compatibilite avec les premieres versions de la migration.
UPDATE public.admin_permissions SET role = 'ADMIN' WHERE role = 'SUPER_ADMIN';
ALTER TABLE public.admin_permissions DROP CONSTRAINT IF EXISTS admin_permissions_role_check;
ALTER TABLE public.admin_permissions ADD CONSTRAINT admin_permissions_role_check CHECK (role = 'ADMIN');
ALTER TABLE public.admin_actions DROP CONSTRAINT IF EXISTS admin_actions_reason_check;
ALTER TABLE public.admin_actions ALTER COLUMN reason SET DEFAULT '';

COMMIT;
