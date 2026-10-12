-- PROF-01 / PROF-02 : prerequis de connexion et d'identification du profil.
-- Executer apres registration.sql. Aucun compte ni profil n'est supprime.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'PENDING';

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON public.auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON public.auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  key_hash CHAR(64) PRIMARY KEY,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry_idx ON public.auth_rate_limits(expires_at);

COMMIT;
