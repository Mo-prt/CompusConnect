# CampusConnect — utiliser votre schéma Supabase existant

Cette version est adaptée aux tables déjà présentes dans le projet `https://xbpzhylcrbaklmalmivv.supabase.co`. Elle conserve les UUID, les données, les enums, les politiques RLS et les relations existantes.

## 1. Complément SQL à appliquer une fois

Dans **Supabase → SQL Editor**, ouvrir puis exécuter :

`supabase/migrations/20261111000100_existing_schema.sql`

Ce script est réexécutable. Il ajoute uniquement quatre fonctions `campus_existing_*`, leurs permissions serveur et un rafraîchissement du cache PostgREST. Il ne crée et ne supprime aucune table, n’efface aucune donnée et ne modifie aucune politique RLS existante. Les fonctions vérifient aussi les rôles et verrouillent la ligne de l’événement pour les inscriptions et les changements de capacité.

L’ancienne migration qui créait `public.users`, `sessions` et une table `events` incompatible a été retirée du dépôt. Ne pas la reprendre depuis un ancien commit.

## 2. Clé serveur et fichiers locaux

Créer `.env` à la racine du projet :

```env
SUPABASE_URL=https://xbpzhylcrbaklmalmivv.supabase.co
SUPABASE_SECRET_KEY=<clé serveur actuelle du même projet>
```

La clé doit commencer par `sb_secret_` (ou être un ancien JWT `service_role`). La clé publique ne permet pas d’utiliser ce backend. Copier la valeur exactement, sans point ni espace ajouté. Garder les valeurs réelles dans les secrets de l’hébergement ou les fichiers locaux ignorés par Git, jamais dans `.env.example`.

Sur Windows/PowerShell, pour le développement avec Wrangler :

```powershell
Copy-Item .env .dev.vars
```

Après modification des valeurs, recopier le fichier puis redémarrer Wrangler. Les fichiers `.env` et `.dev.vars` sont ignorés par Git.

## 3. Vérifier et démarrer

Node.js 24 :

```powershell
npm.cmd ci
npm.cmd run check:supabase
npm.cmd test
npm.cmd run build
npx.cmd wrangler@4 dev dist/server/index.js --port 8787
```

Ouvrir ensuite `http://localhost:8787`.

La vérification de connexion lit uniquement la description de l’API et ne modifie aucune donnée. Elle confirme les tables existantes, le type UUID des événements et la présence des quatre fonctions complémentaires. Un message « fonctions complémentaires absentes » indique qu’il faut appliquer le script SQL de l’étape 1.

## 4. Authentification et rôles réels

L’inscription et la connexion utilisent maintenant **Supabase Auth**. Les profils académiques restent dans `public.profiles` et les rôles sont lus depuis `roles` / `user_roles`.

- Les comptes déjà présents dans Supabase Auth peuvent se connecter avec leur email, leur mot de passe et la filière liée à leur profil.
- Si la confirmation email est activée dans Supabase, un nouveau compte doit d’abord confirmer son email puis se connecter. Dans **Authentication → URL Configuration**, configurer l’URL du site et les URL de redirection autorisées pour le test local (`http://localhost:8787`) et pour le domaine de production. La page de retour retire les jetons éventuels du fragment d’URL et propose la connexion par mot de passe.
- À la première connexion validée, un profil manquant est créé et reçoit uniquement le rôle `student` s’il ne possède aucun rôle.
- Un compte `pending`, `suspended` ou `disabled` n’est pas activé automatiquement.
- Les rôles `teacher`, `department_head`, `organizer` et `admin` restent attribués par l’administration dans les tables existantes.
- Les boutons qui créaient des comptes de démonstration privilégiés ont été retirés. Ils ne correspondent pas aux comptes réels de cette base.

Les jetons Supabase Auth sont stockés dans deux cookies HttpOnly, Secure et SameSite=Strict. Le backend vérifie l’identité auprès de Supabase Auth, renouvelle la session avec le refresh token si nécessaire et vérifie les rôles en base. Il ne fait confiance ni aux rôles du formulaire, ni aux métadonnées fournies par un utilisateur, ni à un UUID envoyé dans un en-tête.

Pour attribuer un rôle à un compte de test existant, l’administrateur peut utiliser le SQL Editor après avoir choisi le bon UUID dans `profiles` :

```sql
INSERT INTO public.user_roles(user_id, role_id)
SELECT '<UUID_DU_PROFIL>'::uuid, id
FROM public.roles WHERE code = 'organizer'
ON CONFLICT DO NOTHING;
```

## 5. Correspondance des données

| Écran | Tables existantes |
| --- | --- |
| Département et responsable | `departments`, `department_heads`, `profiles` |
| Filières et semestres | `programs`, `semesters` |
| Modules | `program_modules`, `modules`, `profiles` |
| Emploi du temps | `timetables`, `timetable_sessions`, `classrooms` |
| Événements | `events`, `event_program_targets` |
| Inscriptions et participants | `event_registrations`, `profiles` |
| Identités et rôles | Supabase Auth, `profiles`, `roles`, `user_roles` |

Les événements utilisent `organizer_id`, `starts_at`, `ends_at` et `location_text`. Les horaires de l’interface suivent le fuseau `Africa/Casablanca`. Les événements peuvent cibler plusieurs filières et avoir une capacité non limitée si `capacity` est `NULL`.

Une désinscription conserve la ligne dans `event_registrations` et passe son statut à `cancelled`. Les places occupées comptent les statuts `registered` et `attended`. Une nouvelle inscription peut réactiver la ligne annulée.

Les heures de module sont `weekly_hours`, donc affichées en heures par semaine. Les séances utilisent `weekday` de 1 (lundi) à 7 (dimanche). Les séances avec `session_date` apparaissent uniquement pendant la semaine correspondante.

## 6. Diagnostic

- **HTTP 401** : clé refusée, révoquée, d’un autre projet ou mal copiée.
- **PGRST202** : fonction complémentaire absente ou cache PostgREST non actualisé.
- **PGRST205 / 42P01** : table manquante ou inaccessible.
- **HTTP 403 / 42501** : permissions insuffisantes.

Le script de compatibilité termine par :

```sql
NOTIFY pgrst, 'reload schema';
```

Pour vérifier les fonctions dans le SQL Editor :

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname LIKE 'campus_existing_%';
```

Les erreurs techniques détaillées restent dans le diagnostic local. Les réponses publiques de l’API ne contiennent ni clé, ni corps brut des erreurs Supabase, ni SQL.

## 7. Limites des vérifications automatisées

Les tests reproduisent les tables MVP1 inspectées et exécutent les vraies fonctions complémentaires dans PostgreSQL embarqué (PGlite). Supabase Auth et le transport PostgREST sont simulés dans ces tests. La commande `check:supabase`, puis un essai avec vos vrais comptes, restent nécessaires pour valider votre projet réel.
