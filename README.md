# CampusConnect FPK — MVP1

Application académique en français, réalisée à partir de la section 8.1 du cahier des charges et des règles métier de la fiche de mission backend.

## Périmètre réalisé

- Inscription étudiante et connexion par email, mot de passe et filière ; profil et déconnexion.
- Trois profils : étudiant, enseignant/chef de département et organisateur, avec routage et autorisations côté serveur.
- Trois filières fictives : SIIA, SMA et SVI ; fiche du chef de département, coordonnées et permanence.
- Référentiel des modules : intitulé, enseignant, objectifs et volume horaire.
- Emploi du temps par filière et semestre ; navigation hebdomadaire ; impression / enregistrement PDF via le navigateur.
- Catalogue et détails d’événements ; recherche et filtres par catégorie, date et filière.
- Inscription et désinscription avant le début ; contrôle atomique de la capacité et de l’unicité ; récapitulatif et export agenda ICS.
- Organisateur : création, modification, annulation, suivi et actualisation des participants ; contrôle de propriété.
- Interface responsive, navigation clavier, fenêtres accessibles et messages d’erreur.

Les annonces, supports de cours, réclamations, bibliothèque, Lost & Found, IA, carte et marketplace appartiennent aux MVP2/3 et ne sont pas implémentés ici.

## Données et comptes de démonstration

Les personnes, contacts, horaires et événements sont fictifs. La page de connexion propose un bouton de démonstration pour chaque profil. Ces comptes et leurs événements sont isolés par visiteur ChatGPT. Les données sont persistées côté serveur dans D1 ; le navigateur conserve seulement un cookie de session HttpOnly.

L’inscription publique crée exclusivement des étudiants, même si une requête tente d’imposer un autre rôle. Les comptes privilégiés réels doivent être attribués par un administrateur de confiance dans la base (champ `role`, valeurs `teacher` ou `organizer`). Le sélecteur de démo ne donne aucun accès aux données du campus réel.

## Architecture déployée

Interface HTML/CSS/JavaScript sans dépendance, API REST dans un Worker Cloudflare ES module, avec base relationnelle Supabase (PostgreSQL) ou D1 (SQLite). La fiche de mission recommande Laravel / MySQL / React ; elle précise que ce choix est recommandé, et que les exigences portent sur l’application web, une base relationnelle et une gestion sécurisée des profils. Ce livrable utilise le runtime natif Sites. Le starter et les helpers Vinext n’étaient pas présents dans l’environnement ; le Worker est construit directement avec le format de déploiement Sites.

- `src/` : interface et données de référence de démonstration.
- `worker/api.mjs` : authentification, validation, autorisation et opérations métier.
- `worker/storage/` : adaptateurs Supabase/PostgREST et D1.
- `supabase/migrations/` : schéma PostgreSQL, RLS et fonctions transactionnelles.
- [Configuration Supabase](docs/SUPABASE.md) : migration, variables et vérification de connexion.
- `drizzle/0000_campus.sql` : migration SQL du schéma ; aucune création de table dans les requêtes.
- `scripts/build.mjs` : construction déterministe des ressources et du Worker.
- `tests/api.test.mjs` : tests d’API avec une véritable base SQLite en mémoire.

## Construire et vérifier

Node.js 24 :

```sh
npm ci
npm test
npm run build
node --check dist/server/index.js
```

Le résultat de publication se trouve dans `dist/`. `.openai/hosting.json` déclare l’identité du site et le binding D1 `DB`. En mode D1, le service Sites applique la migration avant d’activer le Worker. En mode Supabase, appliquer préalablement la migration PostgreSQL et configurer les variables serveur selon [le guide Supabase](docs/SUPABASE.md).

## Contrat API

Toutes les écritures reçoivent du JSON et contrôlent l’origine. Authentification par cookie `campus_session` (HttpOnly, Secure, SameSite=Strict, durée 24h). Mots de passe PBKDF2 SHA-256, sel aléatoire, 100 000 itérations ; jetons de session hachés en base. Limitation des tentatives de connexion.

- `GET /api/auth/me` — profil courant ou null.
- `POST /api/auth/register` — `name, email, password, program` ; crée un étudiant.
- `POST /api/auth/login` — `email, password, program`.
- `POST /api/auth/demo` — `role, program` ; bac à sable de démonstration isolé.
- `POST /api/auth/logout` — invalide la session.
- `PUT /api/profile` — `name, program`.
- `GET /api/bootstrap?program=SIIA&semester=S9` — références, modules, séances et événements du périmètre.
- `POST /api/events` — organisateur ; `title, category, date, time, endTime, location, organizer, capacity, program, image, description`.
- `PUT /api/events/:id` — propriétaire uniquement ; mêmes champs.
- `DELETE /api/events/:id` — annule l’événement, conserve les inscriptions.
- `POST /api/events/:id/register` — étudiant ; inscription atomique.
- `DELETE /api/events/:id/register` — étudiant ; désinscription.
- `GET /api/events/:id/participants` — organisateur propriétaire uniquement.

Codes usuels : 200/201 succès, 400 validation, 401 session absente, 403 droits insuffisants, 404 ressource absente, 409 conflit/capacité/doublon, 429 limite de tentatives.

## Vérification

Dix-sept scénarios automatisés couvrent D1 et le nouvel adaptateur Supabase, avec exécution des fonctions PostgreSQL dans PGlite : autorisations, mots de passe, sessions, isolation, filtrage filière, capacité, inscriptions, participants et opérations organisateur. Le build assemble les modules serveur et les ressources du frontend avec esbuild.

Les tests Supabase utilisent un transport PostgREST simulé. La connexion au projet réel doit être vérifiée avec `npm run check:supabase` après installation du schéma et configuration de la clé serveur. Aucun secret n’est fourni dans le dépôt.
