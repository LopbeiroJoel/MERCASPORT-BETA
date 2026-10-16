-- REPERE ORAL - CATALOGUE DES 14 POSTES.
-- code = valeur stable envoyee a l'API ; label = texte francais affiche ; sort_order = ordre des choix.
-- STRIKER correspond a Buteur. Je ne remets pas SECOND_STRIKER ou CENTRE_FORWARD.
-- ON CONFLICT DO NOTHING evite de recreer un code qui existe deja ; ca ne remet pas ses valeurs a zero.

-- Liste des postes : code pour le backend, label pour le formulaire.
-- Aucun profil joueur ni aucune annonce n'est modifie.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.positions (
  code VARCHAR(50) PRIMARY KEY CHECK (code ~ '^[A-Z_]+$'),
  label VARCHAR(100) NOT NULL CHECK (btrim(label) <> ''),
  sort_order SMALLINT NOT NULL UNIQUE CHECK (sort_order > 0)
);

INSERT INTO public.positions (code, label, sort_order) VALUES
  ('GOALKEEPER', 'Gardien', 1),
  ('CENTRE_BACK', 'Défenseur central', 2),
  ('RIGHT_BACK', 'Latéral droit', 3),
  ('LEFT_BACK', 'Latéral gauche', 4),
  ('RIGHT_WING_BACK', 'Piston droit', 5),
  ('LEFT_WING_BACK', 'Piston gauche', 6),
  ('DEFENSIVE_MIDFIELDER', 'Milieu défensif', 7),
  ('CENTRAL_MIDFIELDER', 'Milieu central', 8),
  ('ATTACKING_MIDFIELDER', 'Milieu offensif', 9),
  ('RIGHT_MIDFIELDER', 'Milieu droit', 10),
  ('LEFT_MIDFIELDER', 'Milieu gauche', 11),
  ('RIGHT_WINGER', 'Ailier droit', 12),
  ('LEFT_WINGER', 'Ailier gauche', 13),
  ('STRIKER', 'Buteur', 14)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Liste a proposer dans le formulaire :
-- SELECT code, label FROM public.positions ORDER BY sort_order;
