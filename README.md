# CampusConnect FPK — Portail étudiant

Portail académique en français pour la Faculté Polydisciplinaire de Khouribga. Le backend est adapté au **schéma Supabase déjà existant** : `profiles`, `user_roles`, `programs`, `events`, `event_registrations`, etc.

Les écrans suivent les fonctionnalités **F01 à F08 du cahier des charges** : compte, département, événements, pédagogie, entraide, assistant et services campus. Voir [la correspondance avec le cahier des charges](docs/DESIGN_ET_FONCTIONNALITES.md).

Les contrats et droits des routes sont décrits dans [la documentation API](docs/API.md).

Le **mode sombre** anthracite et or est actif par défaut sur toutes les pages. Le bouton soleil/lune permet de revenir au mode clair. Le choix est mémorisé dans le navigateur, appliqué dès le chargement et synchronisé entre les onglets, sans recharger les formulaires. Aucune configuration Supabase supplémentaire n’est nécessaire.

Les espaces **Enseignant / Chef de département** et **Organisateur** ont leurs tableaux de bord et menus. L’enseignant suit ses affectations et publications ; l’organisateur gère ses événements, leurs participants et les actualités. Voir [la configuration des comptes et la recette](docs/ESPACES_PERSONNELS.md). Les participants sont actualisés automatiquement toutes les 5 secondes pendant l’ouverture de leur liste.

L’option **Mot de passe oublié ?** utilise les emails de Supabase Auth. Ajouter les URL de retour dans **Authentication → URL Configuration** avant les essais : [configuration et test de la récupération](docs/RECUPERATION_MOT_DE_PASSE.md). Aucune migration SQL supplémentaire n’est nécessaire pour cette option.

Le bouton **Filtrer** des actualités ouvre les choix de catégorie et de recherche pour les visiteurs comme pour les membres.

Les visiteurs sans compte peuvent consulter **Découvrir la FPK**, les départements et filières, les **actualités publiées avec leurs images**, et les événements. Les brouillons et publications futures restent exclus. L’espace académique, les documents et les services personnels exigent une connexion. Cette extension publique n’exige pas de nouvelle migration SQL.

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

Les compléments SQL sont `supabase/migrations/20261111000100_existing_schema.sql` pour le MVP1 et **`supabase/migrations/20261116000100_campus_services.sql`** pour les nouveaux services. La seconde migration ajoute quatre tables auxiliaires, cinq fonctions serveur et le stockage privé, en conservant les tables et données du campus. Elle doit être exécutée dans Supabase avant les essais complets. Aucune clé réelle n’est incluse dans le dépôt.

## Nouveaux services

- Accueil du portail étudiant, identité anthracite/ivoire/or et photographie de la faculté.
- Inscription avec un email universitaire `prenom.nom@usms.ac.ma`, un mot de passe et une filière ; connexion avec email et mot de passe uniquement. La filière est récupérée depuis le profil enregistré.
- Récupération du mot de passe par email, lien temporaire et confirmation du nouveau mot de passe.
- Annonces, documents et bibliothèque avec fichiers privés et audiences par filière.
- Réclamations privées, messages et traitement ; actualités, Lost & Found et projets collaboratifs.
- FPK Map schématique, offres Marketplace et demandes transactionnelles.
- FPK GPT en recherche sourcée, historique et feedback. Le service IA externe n’étant pas encore prêt, son connecteur est préparé et configurable. Suggestions par contenu accessibles à l’utilisateur.

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
- `src/experience.js`, `src/experience.css` : navigation et écrans du cahier des charges.
- `src/theme.js`, `src/theme.css` : thème sombre/clair, initialisation avant affichage et préférence locale.
- `src/spaces.js`, `src/spaces.css` : tableaux de bord et suivi des participants pour les espaces de personnel.
- `worker/api.mjs` : validation et contrôles d’accès.
- `worker/auth.mjs` : cookies, validation des sessions et renouvellement.
- `worker/recovery.mjs` : récupération par email et échange PKCE côté serveur.
- `worker/campus.mjs` : services pédagogiques et communautaires, fichiers, accès et assistant.
- `worker/teaching.mjs` : périmètre des modules et séances de l’enseignant ou du chef de département.
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
- `POST /api/auth/recover`, `GET /api/auth/recovery/callback`, `GET /api/auth/recovery`, `POST /api/auth/password`.
- `PUT /api/profile`.
- `GET /api/bootstrap?program=<code>&semester=<UUID-ou-S1>`.
- `POST /api/events`, `PUT /api/events/:id`, `DELETE /api/events/:id`.
- `POST /api/events/:id/register`, `DELETE /api/events/:id/register`.
- `GET /api/events/:id/participants`.

Les jetons d’accès et de renouvellement restent dans les cookies HttpOnly et ne sont pas renvoyés dans le JSON du frontend. Les erreurs de la base sont filtrées. La vérification réelle de votre projet se fait avec `check:supabase` et vos comptes, après application du complément SQL.
