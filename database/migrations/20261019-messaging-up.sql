BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(621019);
CREATE TABLE IF NOT EXISTS module_migrations(version TEXT PRIMARY KEY, installed_at TIMESTAMPTZ NOT NULL DEFAULT now(), previous JSONB NOT NULL);
INSERT INTO module_migrations(version,previous)
SELECT '20261019-messaging', jsonb_build_object(
  'check_ad_club',pg_get_functiondef('public.check_ad_club()'::regprocedure),
  'check_application',pg_get_functiondef('public.check_application()'::regprocedure),
  'status_constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid))) FROM pg_constraint WHERE conrelid='public.ads'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%'))
ON CONFLICT DO NOTHING;

-- Références SQL : on réutilise positions et divisions, sans les dupliquer.
DO $$ DECLARE n TEXT; BEGIN
  FOREACH n IN ARRAY ARRAY['sports','availability_options','mobility_options','sport_categories','project_types','recruitment_types','recruitment_conditions','announcement_types','announcement_statuses','application_statuses','notification_types','report_reasons','report_statuses'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I(code VARCHAR(50) PRIMARY KEY,label TEXT NOT NULL,sort_order SMALLINT NOT NULL DEFAULT 0,is_active BOOLEAN NOT NULL DEFAULT TRUE)',n);
  END LOOP;
END $$;
INSERT INTO sports VALUES ('FOOTBALL','Football',1,TRUE) ON CONFLICT DO NOTHING;
INSERT INTO availability_options(code,label,sort_order) VALUES ('NOW','Dès maintenant',1),('NEXT_SEASON','Saison prochaine',2),('AFTER_SEASON','Après la saison',3),('DISCUSS','À discuter',4) ON CONFLICT DO NOTHING;
INSERT INTO mobility_options(code,label,sort_order) VALUES ('LOCAL','Ma ville',1),('10_KM','10 km',2),('25_KM','25 km',3),('50_KM','50 km',4),('100_KM','100 km',5),('ANY','Sans limite',6) ON CONFLICT DO NOTHING;
INSERT INTO sport_categories(code,label,sort_order) VALUES ('U18','U18',1),('U19','U19',2),('SENIOR','Seniors',3),('VETERAN','Vétérans',4) ON CONFLICT DO NOTHING;
INSERT INTO project_types(code,label,sort_order) VALUES ('COMPETITION','Compétition',1),('PROGRESSION','Progresser',2),('LEISURE','Loisir',3),('RETURN','Reprise du football',4),('COLLECTIVE','Projet collectif',5) ON CONFLICT DO NOTHING;
INSERT INTO recruitment_types(code,label,sort_order) VALUES ('SEASON','Recrutement pour la saison',1),('TRIAL','Essai',2),('REINFORCEMENT','Renfort ponctuel',3) ON CONFLICT DO NOTHING;
INSERT INTO recruitment_conditions(code,label,sort_order) VALUES ('TRAINING','Entraînements réguliers',1),('WEEKEND','Disponible le week-end',2),('TRANSPORT','Déplacements possibles',3),('EXPENSES','Frais pris en charge',4),('TRIAL','Essai possible',5) ON CONFLICT DO NOTHING;
INSERT INTO announcement_types(code,label,sort_order) VALUES ('PLAYER_SEARCH','Joueur recherche un club',1),('CLUB_SEARCH','Club recherche un joueur',2) ON CONFLICT DO NOTHING;
INSERT INTO announcement_statuses(code,label,sort_order) VALUES ('DRAFT','Brouillon',1),('PUBLISHED','Publiée',2),('SUSPENDED','Suspendue',3),('EXPIRED','Expirée',4),('CLOSED','Clôturée',5),('ARCHIVED','Archivée',6),('DELETED','Supprimée',7) ON CONFLICT DO NOTHING;
INSERT INTO application_statuses(code,label,sort_order) VALUES ('SENT','Envoyée',1),('VIEWED','Consultée',2),('DISCUSSING','En discussion',3),('TRIAL_PROPOSED','Essai proposé',4),('TRIAL_ACCEPTED','Essai accepté',5),('ACCEPTED','Retenue',6),('REJECTED','Refusée',7),('WITHDRAWN','Retirée',8) ON CONFLICT DO NOTHING;
INSERT INTO notification_types(code,label) VALUES ('MESSAGE','Nouveau message'),('APPLICATION','Nouvelle candidature'),('VIEWED','Candidature consultée'),('STATUS','Statut modifié'),('TRIAL_PROPOSED','Essai proposé'),('TRIAL_ACCEPTED','Essai accepté'),('CONTACT','Nouveau contact') ON CONFLICT DO NOTHING;
INSERT INTO report_reasons(code,label,sort_order) VALUES ('SPAM','Spam',1),('HARASSMENT','Harcèlement',2),('FRAUD','Fausse identité ou arnaque',3),('INAPPROPRIATE','Contenu inapproprié',4),('OTHER','Autre',5) ON CONFLICT DO NOTHING;
INSERT INTO report_statuses(code,label) VALUES ('OPEN','À traiter'),('RESOLVED','Traité'),('DISMISSED','Classé sans suite') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sport_qualities(code VARCHAR(50) PRIMARY KEY,label TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('TECHNICAL','PHYSICAL','TACTICAL','MENTAL')),sort_order SMALLINT NOT NULL);
INSERT INTO sport_qualities VALUES
 ('PASSING','Qualité de passe','TECHNICAL',1),('FINISHING','Finition','TECHNICAL',2),('CONTROL','Contrôle','TECHNICAL',3),('DRIBBLING','Dribble','TECHNICAL',4),('CROSSING','Centres','TECHNICAL',5),
 ('SPEED','Vitesse','PHYSICAL',6),('STAMINA','Endurance','PHYSICAL',7),('STRENGTH','Puissance','PHYSICAL',8),('AGILITY','Agilité','PHYSICAL',9),('JUMP','Détente','PHYSICAL',10),
 ('POSITIONING','Placement','TACTICAL',11),('VISION','Vision du jeu','TACTICAL',12),('ANTICIPATION','Anticipation','TACTICAL',13),('PRESSING','Pressing','TACTICAL',14),('VERSATILITY','Polyvalence','TACTICAL',15),
 ('TEAMWORK','Esprit d’équipe','MENTAL',16),('LEADERSHIP','Leadership','MENTAL',17),('COMPOSURE','Sang-froid','MENTAL',18),('COMMITMENT','Implication','MENTAL',19),('DISCIPLINE','Discipline','MENTAL',20) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS preferred_feet(code VARCHAR(10) PRIMARY KEY,label VARCHAR(20) UNIQUE NOT NULL,sort_order SMALLINT NOT NULL);
INSERT INTO preferred_feet VALUES ('RIGHT','Droit',1),('LEFT','Gauche',2),('BOTH','Deux pieds',3),('ANY','Indifférent',4) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS club_memberships(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,is_active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,club_id));
CREATE INDEX IF NOT EXISTS club_memberships_club_idx ON club_memberships(club_id) WHERE is_active;
INSERT INTO club_memberships(user_id,club_id) SELECT user_id,id FROM clubs WHERE user_id IS NOT NULL ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION messaging_manages_club(account INTEGER,club INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM clubs c JOIN users u ON u.id=account WHERE c.id=club AND u.status='ACTIVE' AND (c.user_id=account OR EXISTS(SELECT 1 FROM club_memberships m WHERE m.user_id=account AND m.club_id=club AND m.is_active)))
$$;

ALTER TABLE ads ADD COLUMN IF NOT EXISTS recruitment_version SMALLINT NOT NULL DEFAULT 1,
 ADD COLUMN IF NOT EXISTS announcement_type VARCHAR(50) REFERENCES announcement_types(code),
 ADD COLUMN IF NOT EXISTS sport_code VARCHAR(50) REFERENCES sports(code),
 ADD COLUMN IF NOT EXISTS availability_code VARCHAR(50) REFERENCES availability_options(code),
 ADD COLUMN IF NOT EXISTS mobility_code VARCHAR(50) REFERENCES mobility_options(code),
 ADD COLUMN IF NOT EXISTS category_code VARCHAR(50) REFERENCES sport_categories(code),
 ADD COLUMN IF NOT EXISTS recruitment_type_code VARCHAR(50) REFERENCES recruitment_types(code),
 ADD COLUMN IF NOT EXISTS primary_position VARCHAR(50) REFERENCES positions(code),
 ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE ads SET announcement_type=CASE WHEN club_id IS NULL THEN 'PLAYER_SEARCH' ELSE 'CLUB_SEARCH' END WHERE announcement_type IS NULL;
DO $$ DECLARE c RECORD; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.ads'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%' LOOP EXECUTE format('ALTER TABLE ads DROP CONSTRAINT %I',c.conname); END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ads_recruitment_status_fk' AND conrelid='ads'::regclass) THEN ALTER TABLE ads ADD CONSTRAINT ads_recruitment_status_fk FOREIGN KEY(status) REFERENCES announcement_statuses(code); END IF;
END $$;
CREATE TABLE IF NOT EXISTS ad_qualities(ad_id INTEGER REFERENCES ads(id) ON DELETE CASCADE,quality_code VARCHAR(50) REFERENCES sport_qualities(code),PRIMARY KEY(ad_id,quality_code));
CREATE TABLE IF NOT EXISTS ad_project_types(ad_id INTEGER REFERENCES ads(id) ON DELETE CASCADE,project_code VARCHAR(50) REFERENCES project_types(code),PRIMARY KEY(ad_id,project_code));
CREATE TABLE IF NOT EXISTS ad_conditions(ad_id INTEGER REFERENCES ads(id) ON DELETE CASCADE,condition_code VARCHAR(50) REFERENCES recruitment_conditions(code),PRIMARY KEY(ad_id,condition_code));
CREATE INDEX IF NOT EXISTS ads_market_idx ON ads(announcement_type,status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS ads_filter_idx ON ads(sport_code,division_code,city,availability_code) WHERE status='PUBLISHED';
CREATE INDEX IF NOT EXISTS ads_owner_idx ON ads(author_id,updated_at DESC);

CREATE OR REPLACE FUNCTION check_ad_club() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner INTEGER; city_name TEXT; role_name TEXT; BEGIN
 SELECT upper(role) INTO role_name FROM users WHERE id=NEW.author_id;
 IF role_name IS NULL THEN RAISE EXCEPTION 'Auteur requis' USING ERRCODE='23514'; END IF;
 IF NEW.team_id IS NOT NULL THEN
  SELECT club_id INTO owner FROM teams WHERE id=NEW.team_id;
  IF owner IS NULL OR (NEW.club_id IS NOT NULL AND NEW.club_id<>owner) THEN RAISE EXCEPTION 'Equipe incompatible' USING ERRCODE='23514'; END IF;
  NEW.club_id:=owner;
 END IF;
 IF NEW.club_id IS NULL THEN
  IF role_name<>'PLAYER' OR NEW.team_id IS NOT NULL THEN RAISE EXCEPTION 'Annonce joueur incompatible' USING ERRCODE='23514'; END IF;
  NEW.announcement_type:='PLAYER_SEARCH';
 ELSE
  SELECT c.user_id,c.city INTO owner,city_name FROM clubs c WHERE c.id=NEW.club_id;
  IF NOT FOUND OR NOT (owner=NEW.author_id OR (NEW.recruitment_version=2 AND messaging_manages_club(NEW.author_id,NEW.club_id))) THEN RAISE EXCEPTION 'Club non autorise' USING ERRCODE='23514'; END IF;
  NEW.city:=coalesce(NEW.city,city_name); NEW.announcement_type:='CLUB_SEARCH';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION messaging_lock_ad() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM ads WHERE id=coalesce(NEW.ad_id,OLD.ad_id) FOR UPDATE; RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION messaging_ad_limits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a ads; target INTEGER; BEGIN
 IF TG_TABLE_NAME='ads' THEN target:=coalesce(NEW.id,OLD.id); ELSE target:=coalesce(NEW.ad_id,OLD.ad_id); END IF;
 SELECT * INTO a FROM ads WHERE id=target;
 IF NOT FOUND OR a.recruitment_version<2 THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM ad_positions WHERE ad_id=target)>(CASE WHEN a.announcement_type='CLUB_SEARCH' THEN 3 ELSE 2 END)
 OR (SELECT count(*) FROM ad_qualities WHERE ad_id=target)>5
 OR (SELECT count(*) FROM ad_project_types WHERE ad_id=target)>3
 OR (SELECT count(*) FROM ad_conditions WHERE ad_id=target)>3 THEN RAISE EXCEPTION 'Trop de selections' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE n TEXT; BEGIN
 FOREACH n IN ARRAY ARRAY['ad_positions','ad_qualities','ad_project_types','ad_conditions'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS messaging_lock_ad ON %I',n);
  EXECUTE format('CREATE TRIGGER messaging_lock_ad BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION messaging_lock_ad()',n);
  EXECUTE format('DROP TRIGGER IF EXISTS messaging_ad_limits ON %I',n);
  EXECUTE format('CREATE CONSTRAINT TRIGGER messaging_ad_limits AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION messaging_ad_limits()',n);
 END LOOP;
END $$;
DROP TRIGGER IF EXISTS messaging_ad_limits ON ads;
CREATE CONSTRAINT TRIGGER messaging_ad_limits AFTER INSERT OR UPDATE ON ads DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION messaging_ad_limits();

ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS sport_code VARCHAR(50) REFERENCES sports(code),
 ADD COLUMN IF NOT EXISTS availability_code VARCHAR(50) REFERENCES availability_options(code),
 ADD COLUMN IF NOT EXISTS sport_city VARCHAR(100), ADD COLUMN IF NOT EXISTS sport_stats JSONB,
 ADD COLUMN IF NOT EXISTS sport_season VARCHAR(9), ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN IF NOT EXISTS sport_profile_version SMALLINT NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION messaging_valid_stats(value JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN value IS NULL THEN TRUE WHEN jsonb_typeof(value)<>'object' THEN FALSE ELSE NOT EXISTS(SELECT 1 FROM jsonb_each(value) e WHERE e.key NOT IN ('appearances','goals','assists') OR jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[0-9]{1,5}$') END
$$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='player_sport_stats_check') THEN ALTER TABLE player_profiles ADD CONSTRAINT player_sport_stats_check CHECK(messaging_valid_stats(sport_stats)); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='player_sport_positions_check') THEN ALTER TABLE player_profiles ADD CONSTRAINT player_sport_positions_check CHECK(sport_profile_version<2 OR cardinality(positions)<=4); END IF;
END $$;
CREATE TABLE IF NOT EXISTS player_sport_qualities(user_id INTEGER REFERENCES player_profiles(user_id) ON DELETE CASCADE,quality_code VARCHAR(50) REFERENCES sport_qualities(code),PRIMARY KEY(user_id,quality_code));
CREATE OR REPLACE FUNCTION messaging_lock_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM 1 FROM player_profiles WHERE user_id=coalesce(NEW.user_id,OLD.user_id) FOR UPDATE; RETURN coalesce(NEW,OLD); END $$;
CREATE OR REPLACE FUNCTION messaging_profile_limits() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM player_sport_qualities q JOIN sport_qualities s ON s.code=q.quality_code WHERE q.user_id=coalesce(NEW.user_id,OLD.user_id) GROUP BY s.category HAVING count(*)>5) THEN RAISE EXCEPTION 'Cinq qualites maximum par categorie' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS messaging_lock_profile ON player_sport_qualities;
CREATE TRIGGER messaging_lock_profile BEFORE INSERT OR UPDATE OR DELETE ON player_sport_qualities FOR EACH ROW EXECUTE FUNCTION messaging_lock_profile();
DROP TRIGGER IF EXISTS messaging_profile_limits ON player_sport_qualities;
CREATE CONSTRAINT TRIGGER messaging_profile_limits AFTER INSERT OR UPDATE OR DELETE ON player_sport_qualities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION messaging_profile_limits();

ALTER TABLE applications ADD COLUMN IF NOT EXISTS player_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
 ADD COLUMN IF NOT EXISTS status_code VARCHAR(50) REFERENCES application_statuses(code),
 ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS applications_account_ad_key ON applications(player_user_id,ad_id) WHERE player_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS application_status_history(id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,previous_status_code VARCHAR(50) REFERENCES application_statuses(code),new_status_code VARCHAR(50) NOT NULL REFERENCES application_statuses(code),changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS applications_club_idx ON applications(club_id,created_at DESC);
CREATE INDEX IF NOT EXISTS application_history_idx ON application_status_history(application_id,id);
CREATE OR REPLACE FUNCTION check_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a ads; u users; BEGIN
 SELECT * INTO a FROM ads WHERE id=NEW.ad_id FOR SHARE;
 IF NOT FOUND OR a.status<>'PUBLISHED' OR (a.expires_at IS NOT NULL AND a.expires_at<=now()) OR EXISTS(SELECT 1 FROM users WHERE id=a.author_id AND status IN ('BANNED','DISABLED')) THEN RAISE EXCEPTION 'Annonce indisponible' USING ERRCODE='23514'; END IF;
 IF NEW.player_id IS NOT NULL THEN
  SELECT x.* INTO u FROM players p JOIN users x ON x.id=p.user_id WHERE p.id=NEW.player_id AND upper(x.role)='PLAYER';
  IF NOT FOUND THEN RAISE EXCEPTION 'Joueur invalide' USING ERRCODE='23514'; END IF;
  IF NEW.player_user_id IS NOT NULL AND NEW.player_user_id<>u.id THEN RAISE EXCEPTION 'Identite incompatible' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.player_user_id IS NOT NULL THEN
  SELECT * INTO u FROM users WHERE id=NEW.player_user_id AND upper(role)='PLAYER' AND status='ACTIVE';
  IF NOT FOUND OR a.club_id IS NULL OR a.announcement_type<>'CLUB_SEARCH' OR (NEW.club_id IS NOT NULL AND NEW.club_id<>a.club_id) THEN RAISE EXCEPTION 'Candidature incompatible' USING ERRCODE='23514'; END IF;
  NEW.club_id:=a.club_id; NEW.name:=u.name; NEW.email:=u.email; NEW.status_code:=coalesce(NEW.status_code,'SENT');
 END IF;
 RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS conversations(
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 player_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
 announcement_id INTEGER REFERENCES ads(id) ON DELETE SET NULL,
 context_key VARCHAR(80) NOT NULL DEFAULT 'direct',
 application_id INTEGER UNIQUE REFERENCES applications(id) ON DELETE SET NULL,
 created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_message_at TIMESTAMPTZ);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_context_key ON conversations(player_user_id,club_id,context_key);
CREATE TABLE IF NOT EXISTS conversation_participants(
 id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
 joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_read_at TIMESTAMPTZ,last_read_message_id BIGINT,
 archived_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,share_profile BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE(conversation_id,user_id),UNIQUE(id,conversation_id));
CREATE UNIQUE INDEX IF NOT EXISTS conversation_club_identity_key ON conversation_participants(conversation_id) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_participants_user_idx ON conversation_participants(user_id,conversation_id);
CREATE OR REPLACE FUNCTION messaging_participant_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c conversations; owner INTEGER; BEGIN
 SELECT * INTO c FROM conversations WHERE id=NEW.conversation_id FOR UPDATE;
 SELECT user_id INTO owner FROM clubs WHERE id=c.club_id;
 IF NEW.club_id IS NULL THEN
  IF NEW.user_id<>c.player_user_id OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND upper(role)='PLAYER') THEN RAISE EXCEPTION 'Participant joueur invalide' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.club_id<>c.club_id OR NEW.user_id IS DISTINCT FROM owner OR NEW.user_id=c.player_user_id THEN RAISE EXCEPTION 'Participant club invalide' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messaging_participant_check ON conversation_participants;
CREATE TRIGGER messaging_participant_check BEFORE INSERT OR UPDATE ON conversation_participants FOR EACH ROW EXECUTE FUNCTION messaging_participant_check();
CREATE OR REPLACE FUNCTION messaging_two_participants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target INTEGER; BEGIN
 IF TG_TABLE_NAME='conversations' THEN target:=coalesce(NEW.id,OLD.id); ELSE target:=coalesce(NEW.conversation_id,OLD.conversation_id); END IF;
 IF EXISTS(SELECT 1 FROM conversations WHERE id=target) AND ((SELECT count(*) FROM conversation_participants WHERE conversation_id=target AND deleted_at IS NULL)<>2 OR (SELECT count(*) FROM conversation_participants WHERE conversation_id=target AND club_id IS NULL)<>1) THEN RAISE EXCEPTION 'Deux participants requis' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS messaging_two_participants ON conversations;
CREATE CONSTRAINT TRIGGER messaging_two_participants AFTER INSERT OR UPDATE ON conversations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION messaging_two_participants();
DROP TRIGGER IF EXISTS messaging_two_participants ON conversation_participants;
CREATE CONSTRAINT TRIGGER messaging_two_participants AFTER INSERT OR UPDATE OR DELETE ON conversation_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION messaging_two_participants();
CREATE TABLE IF NOT EXISTS messages(
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sender_participant_id INTEGER NOT NULL,
 sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 message_body TEXT NOT NULL CHECK(btrim(message_body)<>'' AND char_length(message_body)<=4000),
 client_nonce UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),edited_at TIMESTAMPTZ,deleted_at TIMESTAMPTZ,
 FOREIGN KEY(sender_participant_id,conversation_id) REFERENCES conversation_participants(id,conversation_id) ON DELETE CASCADE,
 UNIQUE(sender_participant_id,client_nonce));
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id,created_at,id);
CREATE INDEX IF NOT EXISTS messages_cursor_idx ON messages(conversation_id,id DESC);
CREATE TABLE IF NOT EXISTS user_blocks(blocker_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,blocked_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(blocker_user_id,blocked_user_id),CHECK(blocker_user_id<>blocked_user_id));
CREATE INDEX IF NOT EXISTS user_blocks_reverse_idx ON user_blocks(blocked_user_id,blocker_user_id);
CREATE OR REPLACE FUNCTION messaging_message_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c conversations; p conversation_participants; owner INTEGER; BEGIN
 SELECT * INTO c FROM conversations WHERE id=NEW.conversation_id FOR UPDATE;
 SELECT * INTO p FROM conversation_participants WHERE id=NEW.sender_participant_id AND conversation_id=c.id AND deleted_at IS NULL;
 SELECT user_id INTO owner FROM clubs WHERE id=c.club_id;
 IF p.id IS NULL OR NEW.sent_by_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.sent_by_user_id AND status='ACTIVE')
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=c.player_user_id AND status='ACTIVE')
 OR NOT EXISTS(SELECT 1 FROM users WHERE id=owner AND status='ACTIVE')
 OR (p.club_id IS NULL AND NEW.sent_by_user_id<>c.player_user_id)
 OR (p.club_id IS NOT NULL AND NOT messaging_manages_club(NEW.sent_by_user_id,c.club_id))
 OR EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_user_id=c.player_user_id AND blocked_user_id IN (owner,NEW.sent_by_user_id)) OR (blocked_user_id=c.player_user_id AND blocker_user_id IN (owner,NEW.sent_by_user_id)))
 THEN RAISE EXCEPTION 'Message non autorise' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messaging_message_check ON messages;
CREATE TRIGGER messaging_message_check BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION messaging_message_check();
CREATE TABLE IF NOT EXISTS notifications(
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 type_code VARCHAR(50) NOT NULL REFERENCES notification_types(code),conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
 message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
 announcement_id INTEGER REFERENCES ads(id) ON DELETE CASCADE,event_key TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),read_at TIMESTAMPTZ,
 UNIQUE(recipient_user_id,event_key));
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications(recipient_user_id,id DESC);
CREATE TABLE IF NOT EXISTS reports(id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,reporter_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,reported_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,reason_code VARCHAR(50) NOT NULL REFERENCES report_reasons(code),status_code VARCHAR(50) NOT NULL DEFAULT 'OPEN' REFERENCES report_statuses(code),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ);
CREATE UNIQUE INDEX IF NOT EXISTS reports_dedupe_key ON reports(reporter_user_id,coalesce(conversation_id,0),coalesce(message_id,0),reason_code) WHERE status_code='OPEN';
CREATE TABLE IF NOT EXISTS recruitment_audit(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,action TEXT NOT NULL,resource_type TEXT NOT NULL,resource_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION messaging_application_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status_code IS NOT NULL AND (TG_OP='INSERT' OR OLD.status_code IS DISTINCT FROM NEW.status_code) THEN
  INSERT INTO application_status_history(application_id,previous_status_code,new_status_code,changed_by_user_id)
  VALUES(NEW.id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status_code END,NEW.status_code,nullif(current_setting('mercasport.actor_id',TRUE),'')::INTEGER);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS messaging_application_history ON applications;
CREATE TRIGGER messaging_application_history AFTER INSERT OR UPDATE OF status_code ON applications FOR EACH ROW EXECUTE FUNCTION messaging_application_history();
COMMIT;
