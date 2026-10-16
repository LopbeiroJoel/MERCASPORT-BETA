-- REPERE ORAL - AJOUTER LES COMPTES ET LES FICHES POUR /auth/register.
-- username/email uniques sans tenir compte de la casse. player_profiles et club_profiles pointent vers users.
-- Les tables players/clubs historiques restent utilisees : la route maintient les deux parties.
-- Cette migration ne fait pas de login et n'emet aucun token.

-- Prerequis de POST /auth/register. Executer apres schema.sql (et le seed local).
-- Transaction additive, relancable, sans supprimer ni remplacer les comptes.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username VARCHAR(50);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.users SET username = btrim(name) WHERE username IS NULL;
ALTER TABLE public.users ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (upper(role) IN ('PLAYER', 'CLUB', 'ADMIN'));
-- lower = minuscules ; btrim = sans espaces aux bouts. 'Joel' et ' joel ' ne font pas deux pseudos disponibles.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_ci ON public.users (lower(btrim(username)));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_ci ON public.users (lower(btrim(email)));

-- user_id est a la fois PRIMARY KEY et REFERENCES : une fiche au maximum pour ce compte.
CREATE TABLE IF NOT EXISTS public.player_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id),
  first_name VARCHAR(100) NOT NULL CHECK (btrim(first_name) <> ''),
  last_name VARCHAR(100) NOT NULL CHECK (btrim(last_name) <> ''),
  birth_date DATE,
  positions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  preferred_foot VARCHAR(20) CHECK (preferred_foot IN ('RIGHT', 'LEFT', 'BOTH')),
  height_cm INTEGER CHECK (height_cm BETWEEN 100 AND 250),
  current_club VARCHAR(150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Compatibilite avec le profil cree auparavant dans Neon.
ALTER TABLE public.player_profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.player_profiles ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE public.player_profiles ALTER COLUMN last_name SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.club_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id),
  name VARCHAR(150) NOT NULL CHECK (btrim(name) <> ''),
  city VARCHAR(100) NOT NULL CHECK (btrim(city) <> ''),
  divisions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.registration_rate_limits (
  key_hash CHAR(64) PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS registration_rate_limits_expiry_idx
  ON public.registration_rate_limits (expires_at);

COMMIT;
