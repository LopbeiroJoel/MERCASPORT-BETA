# Recette du module — 19 octobre 2026

- 90 tests existants : inscription, mots de passe, sessions, profils, administration, publication d’offres. Tous réussis, exécution séquentielle pour limiter la mémoire.
- 11 tests API du module : contact sans CV, champs facultatifs, annonces joueur/club, appartenance, XSS stocké comme texte, dédoublonnage, non-lus, candidatures et essais, confidentialité, blocage/signalement, représentants, origine, limites SQL, expiration, pagination, suppression définitive. Tous réussis.
- 2 tests PostgreSQL natif : SSE entre deux instances HTTP et concurrence sur conversations/envois. Tous réussis. Migration appliquée deux fois, annulée puis réappliquée dans la base jetable.
- 6 tests HTTP/SQL historiques et préparation Vercel : tous réussis. Build réussi.
- Recette Chrome avec comptes synthétiques et base jetable : annonce club → candidature → conversation → réception dans le second navigateur → réponse → partage CV → essai proposé et accepté. Aucun accès à Neon pour les écritures de recette.
- Vérification mobile 390 px, tablette 768 px et bureau 1 440 px : aucun débordement horizontal ; navigation liste/discussion, champ de message, CV et formulaires utilisables. Aucune erreur JavaScript observée.
- Sauvegarde Neon privée restaurée dans PostgreSQL isolé. Comparaison des colonnes historiques par nombre de lignes et empreinte, avant/après migration : 26 comptes, 14 clubs, 9 joueurs historiques, 6 fiches joueur, 1 fiche club, 28 équipes, 28 annonces, 4 candidatures et 28 associations annonce/poste conservés.
- Migration exécutée sur Neon après cette restauration de recette : mêmes nombres et empreintes sur les données historiques.
- Connexion directe Neon avec TLS et LISTEN/NOTIFY vérifiée sans créer de compte, de candidature ou de message de démonstration en production.

Les essais locaux ne garantissent pas une disponibilité illimitée ni les quotas de l’hébergeur. Le mode manuel reste disponible si le flux SSE est indisponible. La sauvegarde, ses empreintes et les identifiants de connexion restent hors du dépôt.
