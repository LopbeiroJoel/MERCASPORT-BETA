-- REPERE ORAL - NETTOYAGE APRES LA CONVERSION DES POSTES.
-- Cette etape retire l'ancienne colonne seulement apres verification de la nouvelle liste.
-- Un fichier de nettoyage n'est pas a lancer juste pour voir : le lire ne modifie rien, l'executer oui.

-- Phase 2 : seulement APRES le deploiement du backend utilisant positions.
-- Relancer player-positions.sql juste avant pour convertir les derniers anciens postes.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.player_profiles DROP COLUMN IF EXISTS position;
COMMIT;
