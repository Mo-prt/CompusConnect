# CampusConnect FPK — MVP1

Application académique en français, réalisée à partir de la section 8.1 du cahier des charges CampusConnect de la Faculté Polydisciplinaire de Khouribga.

## Fonctionnalités

- Inscription et connexion par email, mot de passe et filière ; profil et déconnexion.
- Trois profils : étudiant, enseignant/chef de département et organisateur, avec autorisations côté serveur.
- Filières de démonstration SIIA, SMA et SVI ; chef de département, coordonnées et permanence.
- Modules : intitulé, enseignant, objectifs et volume horaire.
- Emploi du temps hebdomadaire par filière et semestre ; impression et export PDF via le navigateur.
- Catalogue d’événements avec recherche et filtres ; détails ; inscription et désinscription ; rappel agenda ICS.
- Organisateur : création, modification, annulation et suivi des participants.
- Contrôle transactionnel de la capacité, prévention des doublons et isolation des périmètres de démonstration.
- Interface responsive, navigation clavier et fenêtres accessibles.

Les annonces, supports de cours, réclamations, bibliothèque, Lost & Found, IA, carte et marketplace appartiennent aux MVP suivants.

## Architecture

Le frontend HTML/CSS/JavaScript appelle l’API `/api` du Worker Cloudflare ES module. Le backend utilise exclusivement Supabase PostgreSQL via HTTPS/PostgREST.

L’authentification est gérée par CampusConnect : mots de passe hachés, sessions côté serveur et cookie HttpOnly. Supabase Auth n’est pas activé. La clé publique Supabase ne suffit pas à authentifier ce backend ; une clé serveur est nécessaire dans les secrets de l’hébergement.

- `src/` : interface et références académiques de démonstration.
- `worker/api.mjs` : validation, authentification, rôles et règles métier.
- `worker/storage/supabase.mjs` : accès aux tables et fonctions RPC Supabase.
- `worker/index.mjs` : point d’entrée du Worker et ressources frontend.
- `supabase/migrations/` : schéma PostgreSQL, permissions, RLS et fonctions transactionnelles.
- `scripts/build.mjs` : construction du Worker avec esbuild.
- `scripts/check-supabase.mjs` : vérification de connexion sans modification de données.
- `tests/` : tests de l’API et du schéma PostgreSQL avec PGlite.
- [Guide Supabase](docs/SUPABASE.md) : installation du schéma et configuration.

## Installation et vérification

Node.js 24 :

```sh
npm ci
npm test
npm run build
```

Le résultat de publication est dans `dist/`. Le build nettoie ce dossier avant de produire le Worker et son manifeste. Les migrations PostgreSQL s’appliquent dans Supabase, selon [le guide](docs/SUPABASE.md).

Variables requises côté serveur :

```env
SUPABASE_URL=https://xbpzhylcrbaklmalmivv.supabase.co
SUPABASE_SECRET_KEY=<votre clé serveur>
```

Pour une vérification locale, copier `.env.example` vers `.env`, compléter la clé dans ce fichier ignoré par Git, puis exécuter `npm run check:supabase`. En production, configurer ces variables directement dans l’hébergement. Aucune clé réelle n’est incluse dans le dépôt.

## Démonstration et données

Les noms, contacts, événements et horaires sont fictifs. La connexion propose un profil de démonstration pour chaque rôle. Les données sont persistées dans Supabase ; le navigateur conserve un cookie de session HttpOnly.

L’inscription crée exclusivement des étudiants. Les rôles privilégiés réels sont attribués par un administrateur de confiance dans la table `users`. Les profils de démonstration utilisent leur propre périmètre.

Les filières, modules et emplois du temps sont définis dans `src/data.mjs`. Les comptes, sessions, événements, inscriptions et tentatives de connexion sont enregistrés dans PostgreSQL.

## API

Écritures en JSON avec contrôle de l’origine. Cookie `campus_session` HttpOnly, Secure, SameSite=Strict, durée 24h. Mots de passe PBKDF2 SHA-256 avec sel aléatoire et 100 000 itérations ; jetons de session hachés en base.

- `GET /api/auth/me` : profil courant.
- `POST /api/auth/register` : inscription étudiante.
- `POST /api/auth/login` : connexion par email, mot de passe et filière.
- `POST /api/auth/demo` : profil de démonstration.
- `POST /api/auth/logout` : invalidation de la session.
- `PUT /api/profile` : modification du nom et de la filière.
- `GET /api/bootstrap?program=SIIA&semester=S9` : références et événements du périmètre.
- `POST /api/events` : création par un organisateur.
- `PUT /api/events/:id` : modification par le propriétaire.
- `DELETE /api/events/:id` : annulation par le propriétaire.
- `POST /api/events/:id/register` : inscription étudiante.
- `DELETE /api/events/:id/register` : désinscription étudiante.
- `GET /api/events/:id/participants` : participants, pour le propriétaire uniquement.

## Tests

Les scénarios exécutent la migration et les fonctions PostgreSQL dans PGlite : permissions, configuration, profils, connexions, mots de passe, sessions, isolation, ciblage filière, capacité, doublons, participants et opérations organisateur.

Le transport PostgREST est simulé. La connexion au projet réel reste à vérifier avec `npm run check:supabase` après application de la migration et configuration de la clé serveur.
