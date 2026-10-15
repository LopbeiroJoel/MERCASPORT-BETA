-- Liste de reference des divisions disponibles pour MercaSport.
-- Ne modifie pas les divisions des equipes ou des clubs existants.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.divisions (
  code VARCHAR(20) PRIMARY KEY,
  sort_order SMALLINT NOT NULL UNIQUE CHECK (sort_order > 0)
);

INSERT INTO public.divisions (code, sort_order) VALUES
  ('D8', 1),
  ('D7', 2),
  ('D6', 3),
  ('D5', 4),
  ('D4', 5),
  ('D3', 6),
  ('D2', 7),
  ('D1', 8),
  ('R3', 9),
  ('R2', 10),
  ('R1', 11),
  ('N3', 12),
  ('N2', 13),
  ('N1', 14)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Consulter la liste :
-- SELECT code FROM public.divisions ORDER BY sort_order;
