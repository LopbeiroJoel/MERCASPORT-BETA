# Messagerie et recrutement — adaptation au projet

Base vérifiée : PostgreSQL Neon, Express 5, sessions JWT en cookie HttpOnly, users/clubs/player_profiles, ads/ad_positions et applications. Les tables de CV, comptes et annonces ne sont pas recréées. Le CV actuel ne contient ni qualités, ni disponibilités, ni statistiques : ces champs seront facultatifs dans player_profiles.

- `ads` reste la table des deux types d'annonces. L'ancienne publication et les anciennes lectures restent compatibles ; le nouveau formulaire utilise le contrat `announcement_type` et `view=market`.
- `applications` reste la table des candidatures. Les candidatures historiques sans compte sont conservées. Les nouvelles candidatures authentifiées possèdent une identité joueur, un statut et un historique.
- Les conversations ont deux identités : un joueur et un club. `club_memberships` autorise plusieurs représentants sans modifier les rôles de connexion ; seuls les administrateurs peuvent accorder ces droits. Un compte joueur peut aussi être représentant autorisé.
- Accès à une conversation : joueur concerné ou propriétaire/représentant actif du club. Les participants ne sont jamais ajoutés par un formulaire arbitraire.
- Vie privée : la fiche complète exige une publication volontaire ou un partage explicite dans la conversation. Les coordonnées suivent toujours leurs booléens de visibilité. Pas de médias, de fichiers ou d'envoi d'e-mails.
- Temps réel : SSE HTTP et notifications PostgreSQL LISTEN/NOTIFY, compatibles avec plusieurs instances. Une connexion SQL directe (pas PgBouncer transactionnel) est ouverte seulement si des lecteurs sont présents et fermée après leur départ. Aucune dépendance de chat ou Redis à payer. Le direct est actif uniquement dans Messages ; fermeture en arrière-plan, reconnexion avec rattrapage depuis SQL. Mode manuel disponible. Les quotas de Neon/Vercel continuent de s'appliquer.
- Chaque changement sensible et chaque transition de candidature sont enregistrés. Les anciens admins conservent leurs suppressions définitives ; les archives métier des conversations/annonces sont distinctes.
- Migration additive versionnée, migration inverse avec garde refusant la perte des nouvelles données, sauvegarde avant exécution et vérification des comptes/annonces historiques.

Ordre : migration + tests isolés, API et permissions, interface, tests d'échange et d'isolation, sauvegarde/migration Neon puis déploiement.
