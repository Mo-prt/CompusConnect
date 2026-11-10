# Connecter CampusConnect à Supabase

Le frontend conserve ses appels `/api`. Le Worker accède à Supabase par HTTPS via PostgREST. Les mots de passe hachés, sessions HttpOnly, rôles et contrôles de filière restent gérés par CampusConnect. Cette migration n’active pas Supabase Auth.

## 1. Préparer le schéma

Dans le SQL Editor du projet `https://xbpzhylcrbaklmalmivv.supabase.co`, exécuter une seule fois :

`supabase/migrations/20261110000100_campusconnect.sql`

La migration est transactionnelle et crée cinq tables, les index, les contraintes et les fonctions RPC. Elle ne supprime aucune table existante. Si le projet possède déjà des tables de même nom dans `public`, vérifier leur schéma avant de l’appliquer : elle échouera plutôt que de remplacer vos données.

Les projets utilisant la CLI Supabase peuvent appliquer le fichier avec `supabase db push` après liaison au bon projet. Les migrations PostgreSQL restent dans `supabase/migrations/`. Les anciennes migrations D1 de `drizzle/` ne doivent pas être exécutées sur Supabase.

Les filières, modules et emplois du temps de démonstration restent définis dans `src/data.mjs`, comme dans la version initiale.

## 2. Enregistrer les variables serveur

Configurer ces variables dans les paramètres de l’hébergement du Worker :

```env
DATA_BACKEND=supabase
SUPABASE_URL=https://xbpzhylcrbaklmalmivv.supabase.co
SUPABASE_SECRET_KEY=<votre clé serveur Supabase>
```

Utiliser une clé `sb_secret_...` depuis les paramètres API Keys de Supabase. Les anciennes clés JWT `service_role` sont également prises en charge. Une clé `sb_publishable_...` ou un ancien JWT `anon` est refusé explicitement, car l’application utilise sa propre authentification serveur.

La clé publique fournie dans la conversation n’est pas nécessaire pour cette architecture et n’est pas intégrée au code. Ne pas remplacer la clé serveur par cette clé publique.

Enregistrer la vraie clé uniquement dans les secrets de l’hébergement, jamais dans le dépôt ni dans le frontend. Pour un Worker Cloudflare géré directement, la commande `wrangler secret put SUPABASE_SECRET_KEY` permet une saisie masquée. Pour Sites, utiliser les variables d’environnement du Site et marquer la valeur comme secrète.

Le suffixe `/rest/v1/` dans une URL copiée est accepté et normalisé. L’origine du projet reste la valeur recommandée.

## 3. Installer, vérifier et construire

Avec Node.js 24 :

```sh
npm ci
npm test
npm run build
```

Pour vérifier la connexion réelle depuis un environnement de développement de confiance, copier `.env.example` vers `.env`, saisir la clé dans ce fichier local ignoré par Git, puis lancer :

```sh
npm run check:supabase
```

La vérification appelle une fonction de lecture sur un périmètre réservé et ne modifie aucune donnée. Un échec indique que la configuration, les autorisations ou la migration doivent être vérifiées.

Déployer le Worker construit avec les variables serveur ci-dessus. Le fichier `.env` est une aide locale : l’hébergement doit recevoir ses propres variables. Le code seul ne crée pas les tables Supabase et ne configure pas les secrets de production.

## 4. Comportement et compatibilité

- `DATA_BACKEND=supabase` sélectionne PostgreSQL. La présence de `SUPABASE_URL` sélectionne aussi Supabase si `DATA_BACKEND` est absent.
- Une configuration Supabase incomplète renvoie une erreur 503 explicite ; elle ne bascule pas silencieusement vers une autre base.
- `DATA_BACKEND=d1` sélectionne explicitement D1. Sans variables Supabase, les déploiements existants continuent d’utiliser le binding `DB`.
- `.openai/hosting.json` conserve son binding D1 pour permettre ce fonctionnement existant. Une fois la migration des données validée et le déploiement Supabase vérifié, il peut être mis à `null` pour une installation exclusivement Supabase.
- Le frontend conserve `registered`, `joined` et `endTime`, les mêmes routes et les mêmes erreurs métier.
- Les données de démonstration sont insérées de manière idempotente dans le périmètre courant.

Les données déjà enregistrées dans D1 ne sont pas transférées automatiquement. Pour les conserver, réaliser un export/import contrôlé dans l’ordre `users`, `events`, `sessions`, `registrations`, `auth_attempts` ; convertir `demo` en booléen et conserver les identifiants, sels, hachages et expirations en millisecondes. Vérifier les comptes et inscriptions avant de changer le backend de production.

## 5. Autorisations et intégrité

RLS est activé sur les cinq tables. Les rôles Supabase `anon` et `authenticated` ne peuvent ni lire ces tables ni appeler les fonctions métier. Seul `service_role`, utilisé par le backend, reçoit les permissions nécessaires. Les fonctions sont `SECURITY INVOKER` avec un `search_path` explicite.

La clé serveur contourne RLS : les contrôles du Worker restent donc indispensables. Les fonctions d’inscription vérifient également le périmètre, le rôle étudiant, la filière, le statut et la date de l’événement.

`campus_register` verrouille la ligne de l’événement avant de compter les participants et d’inscrire l’étudiant. `campus_update_event` prend le même verrou avant de diminuer la capacité. La clé primaire `(event_id, user_id)` empêche les doublons. La limite de tentatives de connexion utilise un upsert PostgreSQL atomique.

## 6. Vérifications incluses

Les tests originaux D1 continuent de passer. Les tests Supabase vérifient le transport HTTP, le refus des clés publiques, la migration et les fonctions SQL sur PostgreSQL embarqué (PGlite), les permissions, les profils, les connexions, les sessions, les événements et les inscriptions.

Le transport PostgREST est simulé dans ces tests. Ils ne remplacent pas la commande `check:supabase` et une recette sur votre véritable projet une fois la migration et les secrets configurés.
