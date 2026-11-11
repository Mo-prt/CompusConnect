# CampusConnect FPK — MVP1

Portail académique en français pour la Faculté Polydisciplinaire de Khouribga. Le backend est adapté au **schéma Supabase déjà existant** : `profiles`, `user_roles`, `programs`, `events`, `event_registrations`, etc.

## Démarrage

Node.js 24. Appliquer d’abord le complément SQL, configurer les secrets puis lancer l’application selon [le guide Supabase](docs/SUPABASE.md).

```powershell
npm.cmd ci
npm.cmd run check:supabase
npm.cmd test
npm.cmd run build
npx.cmd wrangler@4 dev dist/server/index.js --port 8787
```

Sous macOS/Linux, utiliser `npm` et `npx`. Ouvrir `http://localhost:8787`.

Le complément SQL est `supabase/migrations/20261111000100_existing_schema.sql`. Il préserve les tables, données et politiques existantes et ajoute seulement les fonctions transactionnelles nécessaires. Aucune clé réelle n’est incluse dans le dépôt.

## Fonctionnalités MVP1

- Inscription et connexion avec **Supabase Auth**, confirmation email et sessions HttpOnly.
- Rôles issus des tables `roles` / `user_roles` : étudiant, enseignant, chef de département, organisateur et administrateur.
- Département, responsable, filières, modules et emplois du temps lus dans les tables existantes.
- Catalogue d’événements, filtres, plusieurs filières cibles, détails et export agenda.
- Inscription et désinscription avec contrôle transactionnel des places et conservation de l’historique.
- Création, modification, annulation et participants pour les organisateurs autorisés.
- Interface responsive et navigation clavier.

Les données du campus viennent de votre base. Les anciens comptes de démonstration générés par le backend et les références académiques codées en dur ont été retirés.

## Architecture

`Frontend → Worker /api → Supabase Auth + PostgreSQL/PostgREST`

- `src/` : HTML, CSS et interactions du frontend.
- `worker/api.mjs` : validation et contrôles d’accès.
- `worker/auth.mjs` : cookies, validation des sessions et renouvellement.
- `worker/storage/supabase.mjs` : transport HTTP et opérations du schéma existant.
- `worker/storage/catalog.mjs` : lecture et correspondance des données académiques et événementielles.
- `worker/time.mjs` : conversion des horaires du Maroc.
- `supabase/migrations/` : complément SQL non destructif pour les tables existantes.
- `scripts/` : compilation et diagnostic.
- `tests/` : schéma MVP1 reproduit dans PGlite et services Auth/PostgREST simulés.

L’inscription attribue seulement le rôle étudiant à un nouveau profil. Les rôles privilégiés sont administrés en base. Le backend vérifie l’identité auprès de Supabase Auth et ignore les rôles envoyés par le navigateur.

## Configuration

```env
SUPABASE_URL=https://xbpzhylcrbaklmalmivv.supabase.co
SUPABASE_SECRET_KEY=<clé serveur actuelle du même projet>
```

Les valeurs réelles sont à enregistrer dans les secrets de l’hébergement, ou dans `.env` / `.dev.vars` pour les tests locaux. Ces fichiers sont ignorés par Git. La clé publique ne suffit pas pour ce backend.

## API

- `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`.
- `PUT /api/profile`.
- `GET /api/bootstrap?program=<code>&semester=<UUID-ou-S1>`.
- `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id`.
- `POST /api/events/:id/register`, `DELETE /api/events/:id/register`.
- `GET /api/events/:id/participants`.

Les jetons d’accès et de renouvellement restent dans les cookies HttpOnly et ne sont pas renvoyés dans le JSON du frontend. Les erreurs de la base sont filtrées. La vérification réelle de votre projet se fait avec `check:supabase` et vos comptes, après application du complément SQL.
