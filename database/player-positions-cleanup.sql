-- Phase 2 : seulement APRES le deploiement du backend utilisant positions.
-- Relancer player-positions.sql juste avant pour convertir les derniers anciens postes.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.player_profiles DROP COLUMN IF EXISTS position;
COMMIT;
