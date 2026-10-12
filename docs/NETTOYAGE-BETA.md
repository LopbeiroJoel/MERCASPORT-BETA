# Nettoyage MERCASPORT BETA

Toutes les branches et tous les anciens commits de MercaSport sont conserves.

Le doublon de creation de l application Express dans backend/server.js a ete retire : ce fichier reutilise maintenant server.js. Les commandes npm start a la racine et dans backend restent disponibles.

Le contexte pedagogique du 8 octobre a ete deplace de backend/README.md vers docs/archive/contexte-pedagogique-2026-10-08.md. Il est conserve comme historique, car ses descriptions ne correspondent pas toutes au code actuel. Le README racine reste le guide de lancement.

Les fonctions, fichiers HTML/CSS/JS, schemas SQL, tests, configurations et modules de l equipe sont conserves. Les branches front, front-end et sql restent identiques : leurs fichiers ne sont pas des doublons inutiles, mais leurs livrables propres.

La copie Git ne cree pas une nouvelle base Neon ni un deploiement Vercel. Les changements Neon et les fichiers locaux non pousses ne font pas partie de cette copie.
