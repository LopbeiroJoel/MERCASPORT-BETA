-- REPERE ORAL - SCHEMA DE DEPART, A LIRE AVANT LES AUTRES MIGRATIONS.
-- Je garde les instructions exactement comme avant : les ajouts ici sont des commentaires.
-- Ce fichier construit/migre la base historique, ce n'est PAS a lui seul tout l'etat actuel de Neon.
-- Apres lui, registration/profile ajoutent les comptes detailles et sessions ; admin ajoute les permissions.
-- player-positions et ads-recruitment ajoutent les 14 postes, les liens et les annonces sans equipe.
-- Exemple : ici team_id devient obligatoire ; ads-recruitment.sql le rend ensuite facultatif.
-- Exemple : ici role commence en minuscules ; registration.sql accepte ensuite PLAYER/CLUB/ADMIN.
-- Je ne relance pas ce fichier tout seul sur une base actuelle pour reviser : lecture seulement.
-- Le script contient des migrations de donnees et des suppressions d'anciens objets : les commentaires ne l'annulent pas.
-- PETIT LEXIQUE : public = schema SQL ; ce n'est pas le dossier public/ de Vercel.
-- PRIMARY KEY = identifiant unique. REFERENCES = lien qui exige une ligne existante.
-- NOT NULL = valeur obligatoire. NULL = absence, different du texte vide ''.
-- CHECK = regle a respecter. UNIQUE = doublon interdit. DEFAULT = valeur mise si je n'en fournis pas.
-- BEGIN/COMMIT = tout valider ensemble. Une erreur bloque la transaction ; ROLLBACK sert a annuler.
-- Ordre de lecture : comptes -> joueurs/clubs -> equipes -> annonces -> candidatures -> index -> triggers -> vue.

-- MercaSport : club -> equipes -> annonces -> candidatures.
-- Migration additive : aucun DROP TABLE et aucun compte supprime.
BEGIN;
-- Je ne laisse pas la migration attendre un verrou plus de 5 secondes.
-- Ce n'est pas une limite de duree pour toute la migration : seulement pour attendre un verrou.
SET LOCAL lock_timeout = '5s';

-- Comptes et profils existants conserves pour la connexion des joueurs/clubs.
-- 1. USERS = LE COMPTE DE CONNEXION.
-- Le mot de passe du site est hashe ; ca n'a rien a voir avec le compte PostgreSQL de DATABASE_URL.
-- IF NOT EXISTS ne remet pas a jour une table existante : le bloc de controle juste apres verifie sa structure.
CREATE TABLE IF NOT EXISTS public.users (
    -- ID auto-genere : ma cle primaire, stable meme si le pseudo change.
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Ancien nom commun du compte. Le champ username est ajoute par registration.sql.
    name VARCHAR(100) NOT NULL,
    -- Adresse du compte, obligatoire et unique ici. L'index sans casse viendra ensuite.
    email VARCHAR(255) UNIQUE NOT NULL,
    -- Resultat du hachage, jamais le mot de passe brut.
    password_hash TEXT NOT NULL,
    -- Role historique en minuscules. La migration registration remplace ce CHECK pour accepter les roles actuels.
    role VARCHAR(10) NOT NULL CHECK (role IN ('player', 'club', 'admin')),
    -- Date mise par PostgreSQL a la creation si je n'en envoie pas.
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- DO $$ lance un petit bloc SQL procedural sans creer une nouvelle table.
-- Ici je verifie les colonnes attendues de users : si la vieille table est incompatible, je stoppe proprement.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM (VALUES ('id'), ('name'), ('email'), ('password_hash'),
            ('role'), ('created_at')) AS required(column_name)
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            -- information_schema.columns decrit les colonnes de la base : je lis sa structure, pas les comptes eux-memes.
            WHERE c.table_schema = 'public' AND c.table_name = 'users'
              AND c.column_name = required.column_name
        )
    ) THEN
        RAISE EXCEPTION 'Ancienne structure users incompatible : migration necessaire, aucune donnee supprimee.';
    END IF;
END $$;

-- 2. PLAYERS = LE JOUEUR HISTORIQUE.
-- user_id relie ce joueur a son compte users. UNIQUE limite a un joueur historique par compte.
-- La fiche detaillee player_profiles viendra avec registration.sql, pas dans ce bloc.
CREATE TABLE IF NOT EXISTS public.players (
    -- ID du joueur metier, utilise notamment par applications.player_id.
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Lien obligatoire vers users.id ; UNIQUE empeche deux joueurs pour le meme compte.
    user_id INTEGER NOT NULL UNIQUE REFERENCES public.users(id),
    -- Prenom obligatoire et pas seulement des espaces : btrim retire les espaces aux bouts.
    first_name VARCHAR(100) NOT NULL CHECK (btrim(first_name) <> ''),
    -- Nom de famille obligatoire, meme controle de texte non vide.
    last_name VARCHAR(100) NOT NULL CHECK (btrim(last_name) <> '')
);

-- 3. CLUBS = LE CLUB METIER.
-- Son id n'est pas le meme concept que users.id : un club et son compte sont deux lignes reliees.
CREATE TABLE IF NOT EXISTS public.clubs (
    -- ID du club ; les equipes vont pointer vers lui.
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Nom public du club, par exemple FC Hegenheim.
    name VARCHAR(150) NOT NULL,
    -- Ville du club ; elle peut servir de valeur de secours pour une annonce.
    city VARCHAR(100) NOT NULL,
    -- Date de creation du club metier.
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Colonnes historiques conservees ; teams est la reference des divisions.
    -- Compte proprietaire si on en connait un. UNIQUE limite a un club lie par compte.
    user_id INTEGER UNIQUE REFERENCES public.users(id),
    -- Ancien texte comme 'R3 / D4', conserve pour compatibilite ; teams porte les equipes separees.
    divisions TEXT
);
-- ALTER TABLE complete l'ancienne table. DROP NOT NULL autorise des clubs sans compte lie.
-- Cela ne supprime aucune ligne ni la colonne user_id.
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE public.clubs ALTER COLUMN user_id DROP NOT NULL;

-- 4. TEAMS = LES EQUIPES DU CLUB.
-- Un meme club peut avoir une equipe R3 et une equipe D4 : je les distingue au lieu d'ecrire tout dans un texte.
CREATE TABLE IF NOT EXISTS public.teams (
    -- ID de l'equipe, different de l'ID du club.
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Cle etrangere vers le club. CASCADE : supprimer le club entraine ses equipes.
    club_id INTEGER NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    -- Nom de l'equipe, texte non vide.
    name VARCHAR(100) NOT NULL CHECK (btrim(name) <> ''),
    -- Division de cette equipe, par exemple R3. Le catalogue divisions est ajoute dans un autre fichier.
    division VARCHAR(20) NOT NULL CHECK (btrim(division) <> ''),
    -- Categorie comme Senior ; DEFAULT la fournit si rien n'est envoye.
    category VARCHAR(50) NOT NULL DEFAULT 'Senior' CHECK (btrim(category) <> ''),
    -- Date de creation generee par la base.
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- La combinaison club + division + categorie doit etre unique, pas la division seule dans toute la base.
    CONSTRAINT teams_club_division_category_key UNIQUE (club_id, division, category)
);

-- Transformer les anciennes chaines 'R3 / D4' en deux equipes, sans doublon.
-- JE RECUPERE L'ANCIEN TEXTE : 'R3 / D4' devient deux lignes teams.
-- || colle des textes. La sous-requete LATERAL travaille avec le club c de la ligne courante.
INSERT INTO public.teams (club_id, name, division, category)
SELECT c.id, 'Équipe ' || d.division, d.division, 'Senior'
FROM public.clubs c
-- Pour chaque club, je decoupe son ancien champ divisions sur '/'. Chaque morceau donne une division.
CROSS JOIN LATERAL (
    SELECT DISTINCT CASE WHEN upper(btrim(part)) = 'NAT3' THEN 'N3'
                         ELSE upper(btrim(part)) END AS division
    FROM regexp_split_to_table(coalesce(c.divisions, ''), '/') AS parts(part)
    WHERE btrim(part) <> ''
) d
-- Si cette equipe existe deja, je ne la recree pas. C'est ce qui permet de relancer cette partie sans doublon.
ON CONFLICT (club_id, division, category) DO NOTHING;

-- 5. ADS = L'ANNONCE.
-- Dans ce fichier historique chaque annonce exige une equipe. La migration ads-recruitment change ensuite cette regle.
CREATE TABLE IF NOT EXISTS public.ads (
    -- ID de l'annonce : c'est ce nombre que je mets dans /ads/:id.
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Lien vers l'equipe ; obligatoire ICI, facultatif apres ads-recruitment.sql. CASCADE suit la suppression d'equipe.
    team_id INTEGER NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    -- Titre obligatoire et non vide ; 150 caracteres au maximum.
    title VARCHAR(150) NOT NULL CHECK (btrim(title) <> ''),
    -- Resume de l'annonce pour une carte de la liste.
    short_description TEXT,
    -- Ancien poste sous forme de texte. Les nouveaux postes multiples passent par ad_positions.
    position VARCHAR(100) NOT NULL CHECK (btrim(position) <> ''),
    -- Pied souhaite pour l'annonce : valeurs francaises ici, differentes des codes RIGHT/LEFT/BOTH du profil.
    preferred_foot VARCHAR(20) CHECK (preferred_foot IN ('Gauche', 'Droit', 'Deux pieds', 'Indifférent')),
    -- Qualites demandees, texte libre.
    requirements TEXT,
    -- Type de contrat ou proposition, facultatif.
    contract VARCHAR(100),
    -- Rythme/temps demande, facultatif.
    work_time VARCHAR(150),
    -- Salaire sous forme de texte, pas un montant numerique calcule dans ce modele.
    salary VARCHAR(100),
    -- Lieu indique sur l'annonce ; peut prendre le dessus sur la ville du club.
    location VARCHAR(100),
    -- Texte complet affiche dans le detail.
    description TEXT,
    -- Ce que le joueur est amene a faire.
    missions TEXT,
    -- Date qui sert aussi au tri du plus recent au plus ancien.
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Compatibilite avec les anciennes lectures : remplis depuis team_id.
    -- Lien club historique garde pour les anciennes lectures ; le trigger verifie qu'il correspond a l'equipe.
    club_id INTEGER REFERENCES public.clubs(id) ON DELETE CASCADE,
    -- Ville historisee sur l'annonce, completee par le trigger.
    city VARCHAR(100)
);
-- Ces ALTER servent aux bases plus anciennes : CREATE TABLE IF NOT EXISTS seul n'ajouterait pas ces colonnes.
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES public.teams(id) ON DELETE CASCADE;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS preferred_foot VARCHAR(20);
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS requirements TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS contract VARCHAR(100);
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS work_time VARCHAR(150);
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS salary VARCHAR(100);
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS location VARCHAR(100);
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS missions TEXT;
ALTER TABLE public.ads ALTER COLUMN club_id DROP NOT NULL;
ALTER TABLE public.ads ALTER COLUMN city DROP NOT NULL;
ALTER TABLE public.ads ALTER COLUMN description DROP NOT NULL;

-- Reinstaller les regles apres la migration, dans la meme transaction.
-- Je retire temporairement l'ancien controle pour migrer les lignes, puis je le recree plus bas.
-- Tout reste dans la meme transaction : une erreur ne doit pas laisser la base au milieu du changement.
DROP TRIGGER IF EXISTS ads_check_club ON public.ads;
-- Ancienne vue de moderation retiree ; ads_details expose toutes les annonces.
-- Je retire une ancienne vue de moderation, pas la table ads et pas ses annonces.
DROP VIEW IF EXISTS public.approved_ads;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.ads'::regclass AND conname = 'ads_preferred_foot_check') THEN
        ALTER TABLE public.ads ADD CONSTRAINT ads_preferred_foot_check
            CHECK (preferred_foot IN ('Gauche', 'Droit', 'Deux pieds', 'Indifférent'));
    END IF;
END $$;

-- La FK historique ne doit pas bloquer la cascade club -> teams -> ads.
DO $$
-- fk est une variable qui va recevoir une contrainte existante pendant la boucle.
DECLARE fk RECORD;
BEGIN
    -- pg_constraint est le catalogue des contraintes de PostgreSQL.
    -- conrelid = table qui porte le lien ; confrelid = table visee ; contype f = cle etrangere.
    -- confdeltype c = cascade : je remplace seulement les anciennes FK qui n'ont pas cette regle.
    FOR fk IN SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.ads'::regclass AND contype = 'f'
          AND confrelid = 'public.clubs'::regclass AND confdeltype <> 'c'
    LOOP
        -- Je reconstruis cette instruction avec le nom de contrainte lu dans le catalogue.
        -- %I formate un identifiant SQL ; ce nom ne vient pas d'un formulaire utilisateur.
        EXECUTE format('ALTER TABLE public.ads DROP CONSTRAINT %I', fk.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.ads'::regclass AND contype = 'f'
          AND confrelid = 'public.clubs'::regclass AND confdeltype = 'c') THEN
        ALTER TABLE public.ads ADD CONSTRAINT ads_club_id_fkey
            FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Anciens exemples connus : rattachement explicite a une division.
-- Autres annonces : division dans le titre, ou club avec une seule equipe.
-- Une annonce ambiguë bloque la migration plutot que recevoir une equipe au hasard.
-- JE CHERCHE LA BONNE EQUIPE POUR CHAQUE ANCIENNE ANNONCE.
-- WITH nomme un resultat temporaire pour cette requete, ce n'est pas une table permanente.
-- matches compte les correspondances ; je ne remplirai team_id que s'il y en a exactement une.
WITH candidates AS (
    SELECT a.id AS ad_id, min(t.id) AS team_id, count(*) AS matches
    FROM public.ads a JOIN public.clubs c ON c.id = a.club_id
    JOIN public.teams t ON t.club_id = c.id AND t.category = 'Senior'
    WHERE a.team_id IS NULL AND (
        (c.name = 'FC Hégenheim' AND a.title = '[DEMO] Gardien pour la saison' AND t.division = 'R3')
        OR (c.name = 'FC Hégenheim' AND a.title = '[DEMO] Attaquant recherche' AND t.division = 'D4')
        OR (c.name = 'SR Colmar' AND a.title = '[DEMO] Milieu de terrain' AND t.division = 'R1')
        OR (c.name = 'FC Mulhouse' AND a.title = '[DEMO] Defenseur recherche' AND t.division = 'R3')
        OR a.title ~* ('(^|[^[:alnum:]])' || t.division || '([^[:alnum:]]|$)')
        OR (SELECT count(*) FROM public.teams x WHERE x.club_id = c.id AND x.category = 'Senior') = 1
    ) GROUP BY a.id
)
-- min(t.id) ne sert pas a choisir au hasard : le WHERE impose matches = 1.
UPDATE public.ads a SET team_id = m.team_id
FROM candidates m WHERE a.id = m.ad_id AND m.matches = 1;
DO $$
-- Si une annonce n'a toujours pas d'equipe identifiee, je liste ses IDs et je bloque la migration.
-- Je prefere demander une correction plutot que rattacher l'annonce au mauvais club/equipe.
DECLARE unresolved TEXT;
BEGIN
    -- ::text convertit l'ID en texte ; string_agg colle les IDs dans un message pour retrouver les lignes a corriger.
    SELECT string_agg(id::text, ', ' ORDER BY id) INTO unresolved FROM public.ads WHERE team_id IS NULL;
    IF unresolved IS NOT NULL THEN
        RAISE EXCEPTION 'Division inconnue pour les anciennes annonces %. Ajouter la division exacte a leur titre puis relancer. Migration annulee sans perte.', unresolved;
    END IF;
END $$;
-- Ici seulement, apres la verification, je rends l'equipe obligatoire dans la version historique du schema.
ALTER TABLE public.ads ALTER COLUMN team_id SET NOT NULL;
-- COALESCE prend la premiere valeur non NULL. left(description, 200) fabrique le debut du resume.
UPDATE public.ads a SET location = coalesce(a.location, a.city, c.city),
    short_description = coalesce(a.short_description, left(a.description, 200))
FROM public.teams t JOIN public.clubs c ON c.id = t.club_id WHERE t.id = a.team_id;

-- 6. APPLICATIONS = LA CANDIDATURE, AVEC SON MESSAGE ET SA DATE.
-- Une annonce a plusieurs candidatures ; un joueur peut candidater a plusieurs annonces.
-- Cette table porte le lien ET les informations propres a chaque candidature.
CREATE TABLE IF NOT EXISTS public.applications (
    -- ID de la candidature creee ; RETURNING peut le renvoyer juste apres l'INSERT.
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Annonce visee, obligatoire. CASCADE retire ses candidatures si l'annonce est supprimee.
    ad_id INTEGER NOT NULL REFERENCES public.ads(id) ON DELETE CASCADE,
    -- Nom declare par la personne qui candidate, conserve avec le message.
    name VARCHAR(200) NOT NULL CHECK (btrim(name) <> ''),
    -- Email declare pour cette candidature : ce n'est pas forcement un compte connecte.
    email VARCHAR(255) NOT NULL CHECK (btrim(email) <> ''),
    -- Telephone facultatif : NULL si non renseigne.
    phone VARCHAR(30),
    -- Message conserve ; vide par defaut ; limite de 2000 caracteres.
    message TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 2000),
    -- Date de la candidature : c'est l'une des informations demandees dans le PDF.
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Facultatif : conserve le lien des candidatures des joueurs connectes.
    -- Lien facultatif vers un joueur existant ; NULL permet une candidature sans compte.
    player_id INTEGER REFERENCES public.players(id),
    -- Un meme joueur ne candidate qu'une fois a la meme annonce. Le controle email plus bas couvre aussi les candidatures sans joueur.
    CONSTRAINT applications_player_ad_key UNIQUE (player_id, ad_id)
);
-- Je complete les anciennes candidatures avec nom/email/telephone, pour accepter aussi celles sans compte.
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS name VARCHAR(200);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE public.applications ALTER COLUMN player_id DROP NOT NULL;
DROP TRIGGER IF EXISTS applications_check_public_ad ON public.applications;
-- Je reprends nom/email du compte seulement quand l'ancienne candidature a un joueur lie.
-- Je ne remplace pas une valeur deja presente : COALESCE conserve la premiere valeur non NULL.
UPDATE public.applications ap SET name = coalesce(ap.name, u.name), email = coalesce(ap.email, u.email)
FROM public.players p JOIN public.users u ON u.id = p.user_id WHERE p.id = ap.player_id;
ALTER TABLE public.applications ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.applications ALTER COLUMN email SET NOT NULL;
DO $$
DECLARE fk RECORD;
BEGIN
    -- Remplacer seulement l'ancienne FK vers ads pour ajouter ON DELETE CASCADE.
    FOR fk IN SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.applications'::regclass AND contype = 'f'
          AND confrelid = 'public.ads'::regclass AND confdeltype <> 'c'
    LOOP
        EXECUTE format('ALTER TABLE public.applications DROP CONSTRAINT %I', fk.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.applications'::regclass AND contype = 'f'
          AND confrelid = 'public.ads'::regclass AND confdeltype = 'c') THEN
        ALTER TABLE public.applications ADD CONSTRAINT applications_ad_id_fkey
            FOREIGN KEY (ad_id) REFERENCES public.ads(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.applications'::regclass AND conname = 'applications_contact_check') THEN
        ALTER TABLE public.applications ADD CONSTRAINT applications_contact_check
            CHECK (btrim(name) <> '' AND btrim(email) <> '');
    END IF;
END $$;

-- 7. INDEX = AIDER LES RECHERCHES.
-- Un index sur l'equipe aide les lectures par equipe ; l'index de date aide l'ordre des annonces.
CREATE INDEX IF NOT EXISTS ads_team_id_idx ON public.ads(team_id);
CREATE INDEX IF NOT EXISTS ads_created_idx ON public.ads(created_at DESC);
CREATE INDEX IF NOT EXISTS applications_ad_id_idx ON public.applications(ad_id);
-- Meme annonce + meme email nettoye/minuscule = une seule candidature, meme si le nom envoye change.
CREATE UNIQUE INDEX IF NOT EXISTS applications_ad_email_key
    ON public.applications(ad_id, lower(btrim(email)));

-- 8. TRIGGER D'ANNONCE : UNE SECURITE COTE POSTGRESQL.
-- NEW represente la ligne qu'on veut inserer/modifier. Je peux la controler et completer ses champs.
-- Cette version exige une equipe ; ads-recruitment.sql remplacera ensuite cette fonction.
CREATE OR REPLACE FUNCTION public.check_ad_club() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE owning_club INTEGER; club_city TEXT;
BEGIN
    SELECT c.id, c.city INTO owning_club, club_city
    FROM public.teams t JOIN public.clubs c ON c.id = t.club_id
    -- FOR SHARE garde les lignes de reference stables pendant cette ecriture : c'est un verrou de transaction.
    WHERE t.id = NEW.team_id FOR SHARE OF t, c;
    -- NOT FOUND signifie que le SELECT precedent n'a rien trouve. Je leve une erreur au lieu de laisser passer.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Une equipe existante est obligatoire.' USING ERRCODE = '23503';
    END IF;
    IF NEW.club_id IS NOT NULL AND NEW.club_id <> owning_club THEN
        RAISE EXCEPTION 'Le club ne correspond pas a celui de l equipe.' USING ERRCODE = '23514';
    END IF;
    -- En PL/pgSQL, := affecte une valeur. Je remplis le club d'apres l'equipe plutot que croire le formulaire.
    NEW.club_id := owning_club;
    NEW.city := coalesce(NEW.location, club_city);
    RETURN NEW;
END $$;
-- La fonction seule ne s'execute pas a chaque ecriture : ce TRIGGER la branche sur INSERT/UPDATE.
-- BEFORE signifie avant de stocker la ligne ; FOR EACH ROW signifie pour chaque ligne touchee.
CREATE OR REPLACE TRIGGER ads_check_club
BEFORE INSERT OR UPDATE ON public.ads
FOR EACH ROW EXECUTE FUNCTION public.check_ad_club();

-- 9. TRIGGER DE CANDIDATURE : VERIFIER LES LIENS.
-- player_id peut etre absent. S'il est present, il doit correspondre a un compte joueur.
-- Cette version cherche une annonce via son equipe ; ads-applications.sql l'adapte ensuite aux annonces sans equipe.
CREATE OR REPLACE FUNCTION public.check_application() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE player_name TEXT; player_email TEXT;
BEGIN
    IF NEW.player_id IS NOT NULL THEN
        SELECT u.name, u.email INTO player_name, player_email
        FROM public.players p JOIN public.users u ON u.id = p.user_id
        WHERE p.id = NEW.player_id AND upper(u.role) = 'PLAYER' FOR SHARE OF p, u;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Le profil doit appartenir a un joueur.' USING ERRCODE = '23514';
        END IF;
        -- Si le nom/email etaient deja fournis, COALESCE les garde ; sinon je prends ceux du compte lie.
        NEW.name := coalesce(NEW.name, player_name);
        NEW.email := coalesce(NEW.email, player_email);
    END IF;
    -- PERFORM cherche juste si le lien existe ; je n'ai pas besoin de garder toutes les colonnes du resultat.
    PERFORM 1 FROM public.ads a JOIN public.teams t ON t.id = a.team_id
    JOIN public.clubs c ON c.id = t.club_id
    WHERE a.id = NEW.ad_id
    FOR SHARE OF a, t, c;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Une candidature exige une annonce existante.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;
-- Le controle se rejoue aussi si on change joueur, annonce, nom ou email d'une candidature existante.
CREATE OR REPLACE TRIGGER applications_check_ad
BEFORE INSERT OR UPDATE OF player_id, ad_id, name, email ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.check_application();

-- Lecture complete des annonces avec leur club et leur equipe.
-- 10. ADS_DETAILS = UNE VUE POUR PREPARER LA LECTURE DE L'API.
-- Je rassemble annonce + equipe + club et je renomme certains champs avec AS.
-- Les JOIN historiques excluent les annonces sans equipe. La nouvelle vue de ads-recruitment passe en LEFT JOIN.
-- Une vue n'est pas une nouvelle copie physique de toutes les annonces : c'est une requete enregistree.
CREATE OR REPLACE VIEW public.ads_details AS
SELECT a.id, c.id AS club_id, c.name AS club_name, a.title, a.position,
       a.city, a.description, a.created_at,
       a.team_id, t.name AS team_name, t.division, a.short_description,
       a.preferred_foot, a.requirements, a.contract, a.work_time, a.salary,
       a.location, a.missions
FROM public.ads a JOIN public.teams t ON t.id = a.team_id
JOIN public.clubs c ON c.id = t.club_id
;

-- Suppression uniquement des anciens champs de moderation, pas des annonces.
-- Je retire un ANCIEN champ status de clubs, pas le compte users et pas le statut actuel users.status.
ALTER TABLE public.clubs DROP COLUMN IF EXISTS status;

-- FIN : toutes les operations de cette transaction sont validees ensemble si aucune erreur n'a bloque.
COMMIT;
