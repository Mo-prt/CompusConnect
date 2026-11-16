# CampusConnect — adaptation de la maquette des 16 écrans

Cette version reprend la maquette communiquée le 16 novembre 2026. La référence visuelle est **Mine & Innovation** : anthracite, ivoire, or et illustration du patrimoine minier de Khouribga. L’identité institutionnelle reste celle de la Faculté Polydisciplinaire de Khouribga, Université Sultan Moulay Slimane.

## Correspondance des écrans et des fonctions

| Écran | Route | Fonctionnement livré dans le code |
| --- | --- | --- |
| 01. Accueil public | `#landing` | Présentation, filières disponibles, événements publiés, accès connexion/inscription. La page reste affichable si la base est indisponible. |
| 02. Inscription | `#register` | Nom, email, mot de passe confirmé, filière ; confirmation email Supabase Auth. Attribution du rôle étudiant seulement. |
| 03. Connexion | `#login` | Email/mot de passe/filière, session persistante ou session de navigateur, récupération de mot de passe. Google apparaît seulement si le fournisseur est activé. |
| 04. Choix du profil | `#choose-profile` | Ouverture d’un espace autorisé ; demande d’accès enseignant/organisateur si nécessaire. L’administrateur approuve dans Mon profil. |
| 05. Tableau de bord | `#dashboard` | Journée académique, compteurs issus de la base, annonces récentes, événements et inscriptions. |
| 06. Mon département | `#department` | Présentation, responsable, filières et contact ; onglets fonctionnels. |
| 07. Modules et EDT | `#modules`, `#schedule` | Recherche, objectifs, enseignants, volume horaire, semestre, navigation hebdomadaire et impression/export PDF via le navigateur. |
| 08. Annonces | `#announcements` | Lecture des annonces publiées pour la filière ; publication par l’enseignant responsable ou le chef autorisé, avec ciblage transactionnel. |
| 09. Documents / Smart Library | `#documents`, `#library` | Upload, recherche et filtres, documents par module, bibliothèque, liens externes, audiences toutes filières/ma filière/privé, téléchargements contrôlés. |
| 10. Réclamations | `#complaints` | Dépôt, fil de messages, suivi et traitement par les personnes autorisées ; transitions de statut contrôlées. |
| 11. Événements | `#events`, `#organizer` | Catalogue et détails, filtres, inscription/désinscription, agenda, création/modification/annulation, participants avec bouton d’actualisation. |
| 12. Actualités | `#news` | Lecture, recherche et publication par les profils habilités ; photo de couverture facultative. |
| 13. Lost & Found | `#lost` | Déclaration perdu/trouvé, photo, lieu, contact choisi par l’auteur, recherche et clôture/restitution par l’auteur. |
| 14. Collaboration | `#collaboration` | Projets ouverts, adhésion, discussions réservées aux contributeurs, partage de fichiers ou de ressources accessibles à toutes les filières, clôture par le créateur. |
| 15. FPK GPT | `#assistant`, `#recommendations` | Recherche sourcée, conversations privées, citations et feedback ; connecteur FastAPI préparé ; suggestions par contenu accessibles à l’utilisateur. |
| 16. FPK Map / Marketplace | `#map`, `#marketplace` | Carte schématique liée aux lieux enregistrés ; ajout de lieux par un administrateur. Offres avec images/prix MAD/type, demandes, acceptation/refus/annulation/finalisation et historique. |

Les écrans affichent des états vides lorsque le projet ne contient pas encore de données. Aucun compte, inscription, avis ou compteur de démonstration n’est créé automatiquement. L’illustration minière est une illustration générée, pas une photographie certifiée du campus.

## Identité visuelle

| Token | HEX | Usage |
| --- | --- | --- |
| `--ink` | `#203036` | Barre latérale, titres, bandeaux |
| `--paper` | `#FBF7F0` | Fond ivoire |
| `--surface` | `#FFFDF9` | Cartes et formulaires |
| `--primary` | `#A5660B` | Boutons et liens d’action |
| `--gold` | `#B77B17` | Accents, sélection, illustration |
| `--gold-soft` | `#F8E9CB` | Fonds de badges |
| `--line` | `#E3DDD2` | Séparateurs et bordures |
| `--muted` | `#726F69` | Texte secondaire |

La nouvelle expérience est dans `src/experience.js` et `src/experience.css`. Les fonctions MVP1 conservées sont dans `src/app.js`. Le Worker sert les deux scripts dans l’ordre, puis les deux feuilles de style réunies. Les layouts couvrent desktop, tablette et mobile. Les dialogues sont accessibles au clavier et les contenus utilisateur sont échappés.

## Activation sur le projet Supabase existant

1. Conserver les tables et données existantes. La première migration `20261111000100_existing_schema.sql` reste nécessaire pour le MVP1 ; elle a déjà été appliquée sur le projet initial.
2. Exécuter **`supabase/migrations/20261116000100_campus_services.sql`** dans le SQL Editor du même projet. Elle ajoute la colonne facultative `news_posts.category`, quatre tables préfixées `campus_`, cinq fonctions serveur et un bucket privé `campus-files` s’il n’existe pas. Elle ne supprime aucune table/donnée et ne remplace pas les politiques des tables existantes.
3. Dans **Storage**, vérifier que `campus-files` est privé. Une configuration existante n’est pas écrasée ; l’upload refuse un bucket public. PDF, PNG, JPEG et WebP acceptés, 10 Mo maximum. Les signatures des fichiers sont contrôlées côté serveur.
4. Renseigner les valeurs réelles de `.env` / `.dev.vars` ou du gestionnaire de secrets de l’hébergement. Ne pas committer ces fichiers.
5. Exécuter `npm.cmd run check:supabase`, puis les tests et la compilation.

La migration suppose le schéma CampusConnect existant inspecté, y compris les tables des MVP2/3 (`announcements`, `files`, `complaints`, etc.). Elle n’est pas un installateur de base vide. Les nouvelles tables sont protégées par RLS et n’accordent aucun accès direct à `anon` ou `authenticated` ; le Worker applique les règles d’accès avec l’identité vérifiée par Supabase Auth.

## Google et récupération de mot de passe

Dans **Authentication → URL Configuration**, autoriser le domaine de production et, pour le développement, les URL :

```text
http://localhost:8787
http://localhost:8787/api/auth/callback
http://localhost:8787/api/auth/callback?flow=recovery
```

Ajouter les mêmes chemins sous le domaine de production. Utiliser `localhost` de façon cohérente pendant les essais. Activer et configurer Google dans **Authentication → Sign In / Providers → Google**, puis renseigner dans Google Cloud le callback Supabase affiché par ce fournisseur.

La connexion Google et la récupération utilisent PKCE avec un vérificateur en cookie HttpOnly de courte durée. L’échange du code reste côté serveur. La récupération exige l’ouverture du lien dans le même navigateur. Les comptes inactifs ne sont pas réactivés et les rôles ne proviennent jamais du formulaire ni des métadonnées Google.

## FPK GPT et recommandations

L’équipe a confirmé que l’API IA de Salma n’est pas encore prête. Le mode par défaut est donc **recherche sourcée** : extraits des annonces, modules, documents, ressources, événements et EDT accessibles ; citations et abstention lorsque rien ne correspond. Ce mode n’appelle aucun LLM et ne revendique pas les objectifs de pertinence/latence du futur RAG.

Quand le service sera prêt, configurer côté serveur :

```env
FASTAPI_URL=https://service-ia.exemple/api/
FASTAPI_TOKEN=<secret service-à-service>
```

Le Worker appelle `POST <FASTAPI_URL>/query` avec `Authorization: Bearer <FASTAPI_TOKEN>` :

```json
{
  "question": "Où se déroule le cours ?",
  "sources": [
    {"id":"UUID", "type":"announcement", "title":"Changement de salle", "text":"La séance est en B12."}
  ]
}
```

Réponse attendue :

```json
{"answer":"La séance se déroule en B12.","source_ids":["UUID"],"abstained":false}
```

Seules les sources déjà filtrées sont transmises. Les identifiants cités doivent appartenir à cet ensemble. Aucune clé IA n’est envoyée au navigateur. Les redirections du service sont refusées et les appels expirent après 12 secondes. Le benchmark des 50 questions et les seuils du cahier des charges restent à mesurer avec le service final.

Les suggestions actuelles sont calculées par correspondance avec les modules (`content-rules-v1`), puis filtrées par visibilité. Elles n’affichent pas un faux score de pertinence. Leur feedback est enregistré pour l’intégration future du moteur IA.

## Règles métier à conserver

- Chaque requête vérifie la session et l’état du compte ; un choix de profil n’accorde aucun rôle.
- Un enseignant publie pour les modules dont il est responsable ; un chef agit dans son département.
- Les documents privés ne sont pas accessibles par simple connaissance de leur UUID.
- L’auteur d’une réclamation, son responsable désigné, le chef compétent et l’administrateur disposent des accès prévus ; les autres étudiants ne voient pas son contenu.
- Un contributeur rejoint un projet avant de poster. Une ressource de bibliothèque privée ne peut pas être diffusée par son simple identifiant.
- L’acceptation des demandes Marketplace est transactionnelle et verrouille l’offre : une seule demande peut être acceptée. La clôture conserve les transactions.
- Les notifications sont internes à l’application. Aucun email aux collègues ou aux étudiants n’est envoyé par cette adaptation.
- La liste des participants se recharge après les actions et avec « Actualiser la liste ». Aucun abonnement temps réel Supabase n’est configuré.
- La carte est schématique. Elle ne prétend pas fournir un plan géographique officiel ni une navigation GPS.
- Aucun paiement, billetterie ou livraison en ligne n’est ajouté.

## Vérification et recette d’équipe

```powershell
npm.cmd ci
npm.cmd run check:supabase
npm.cmd test
npm.cmd run build
npx.cmd wrangler@4 dev dist/server/index.js --port 8787
```

Les tests exécutent les vraies fonctions SQL dans PGlite et simulent les transports Auth, PostgREST et Storage. Les contrôles de frontend utilisent un environnement DOM simulé et ne remplacent pas une recette visuelle au navigateur. La CI GitHub exécute les tests et la compilation sans clé réelle.

Avant une livraison, essayer avec de vrais comptes : confirmation email, Google si activé, récupération, quatre profils, téléchargement privé, cycle de réclamation, partage inter-filières, réservation Marketplace et navigation mobile/clavier. Cette étape valide la configuration du projet distant, qui n’est pas modifiée automatiquement par un `git pull`.
