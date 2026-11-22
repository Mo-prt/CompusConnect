# CampusConnect — écrans et périmètre du cahier des charges

Le cahier des charges fonctionnel et technique FPK est la référence. La maquette sert à organiser les écrans ; elle n’ajoute pas de nouveaux services. L’identité affichée est **CampusConnect — Faculté Polydisciplinaire de Khouribga, Université Sultan Moulay Slimane**.

## Fonctions retenues

| Référence | Écrans | Fonctions conservées |
| --- | --- | --- |
| **F01 — MVP1** | Inscription, connexion, choix de l’espace, profil | Inscription avec email universitaire `prenom.nom@usms.ac.ma`, mot de passe et filière ; connexion avec email et mot de passe, filière lue depuis le profil ; confirmation email ; rôles Étudiant, Enseignant/Chef de département et Organisateur déjà attribués au compte. Aucun choix de profil ne donne de permissions. |
| **F02 — MVP1** | Mon département, modules, emploi du temps | Fiche du responsable, coordonnées académiques, modules et objectifs, enseignants, volumes horaires, filière/semestre, consultation hebdomadaire et téléchargement/impression de l’EDT. |
| **F03 — MVP1** | Catalogue, détail, inscriptions et espace organisateur | Filtres catégorie/date/filière, informations de l’événement, inscription/désinscription, contrôle des places, création, modification, annulation et participants. |
| **F04 — MVP2** | Annonces, documents et réclamations | Communications ciblées des enseignants, supports de cours/TD/TP, téléchargement autorisé, dépôt et suivi d’une réclamation pédagogique ou technique. |
| **F05 — MVP2** | Actualités et Lost & Found | Vie du campus, annonces d’objets perdus/trouvés avec photo, lieu et contact, filtres de statut et restitution/clôture. |
| **F06 — MVP2** | Smart Library et collaboration | Recherche de livres/articles/rapports, partage de ressources et projets transversaux entre filières. |
| **F07 — MVP3** | FPK GPT et recommandations | Sources internes, réponses et feedback, suggestions de ressources/événements ; connecteur du futur service IA. La recherche sourcée reste active tant que l’API IA n’est pas prête. |
| **F08 — MVP3** | FPK Map et Marketplace | Localisation des locaux enregistrés et des services du campus ; publication, demande et clôture des offres d’échange, de prêt, de don ou de cession de matériel étudiant. |

Références : sections 4, 6, 8, 9, 10 et 15 du cahier des charges fourni. Les fonctions d’administration interne nécessaires à la sécurité et au paramétrage des données ne constituent pas de nouveaux modules étudiants.

## Accueil public

À la demande de l’équipe, l’accueil comporte un accès visiteurs : présentation de la FPK, photo de la faculté, départements et filières, aperçu des actualités, liste publique filtrable et lecture intégrale des articles, ainsi que les événements publiés. Aucune authentification n’est nécessaire pour ces informations. Il ne présente ni catalogue commercial de formations, ni admissions, recherche institutionnelle, carrières ou offres partenaires indépendantes du portail.

Seuls les articles au statut `published` dont la date de publication est atteinte sont exposés. Pour une ancienne actualité sans date de publication, la date de création est utilisée. Les publications futures, brouillons et articles retirés sont exclus de la liste, du détail et des images publiques.

Le formulaire de publication informe les enseignants et organisateurs qu’une actualité et son image seront visibles par tous les visiteurs. Les annonces pédagogiques, documents, réclamations, conversations et données de profils ne deviennent pas publics. Les images d’articles sont servies par une route qui vérifie leur rattachement à une actualité publiée, sans rendre le bucket public.

Les textes et éléments de marque miniers sont retirés. La navigation ne comporte plus de pages promotionnelles séparées. Les photos et annonces publiées par les utilisateurs dans les modules prévus restent liées à leur contenu.

## Écrans retirés du périmètre

- Connexion par un fournisseur tiers ajoutée à la maquette.
- Option de connexion persistante dans le formulaire ; les cookies de session restent gérés côté serveur.
- Demande d’un rôle privilégié et interface d’approbation des demandes.
- Centre de notifications et actions associées.
- Pages d’admissions, de carrières ou de promotion commerciale de formations.
- Écran de création de lieux depuis l’interface étudiante ; la carte utilise les lieux paramétrés dans la base.

Les anciennes routes applicatives de connexion tierce, de demandes de rôles et de notifications ne sont plus exposées. Les migrations et tables historiques ne sont pas supprimées : cette correction ne détruit aucune donnée.

La récupération du mot de passe a été ajoutée sur demande explicite de l’équipe comme complément à F01 : email via Supabase Auth, retour PKCE côté serveur, lien temporaire et confirmation du nouveau mot de passe. Elle reprend le thème des écrans de connexion et ne demande pas de filière pour envoyer le lien. Voir [configuration et essai](RECUPERATION_MOT_DE_PASSE.md).

Les actualités publiques et celles de l’espace membre utilisent un bouton **Filtrer** à la place des onglets de catégorie et de la barre de recherche. Il ouvre une fenêtre avec catégorie et mot-clé, applique la sélection et permet de la réinitialiser.

## Présentation et accessibilité

La photographie de façade indiquée par l’utilisateur est intégrée depuis la couverture publique de la page officielle FPK (JPEG disponible : 640 × 288). Elle est cadrée avec CSS sans modifier le fichier ni ajouter de texte sur la façade. La provenance est documentée dans `src/assets/README.md`.

Le thème anthracite, ivoire et or est conservé. Les couleurs du mode clair sont centralisées dans `src/experience.css` :

| Token | HEX | Usage |
| --- | --- | --- |
| `--ink` | `#203036` | Menu, titres et bandeaux |
| `--paper` | `#FBF7F0` | Fond de page |
| `--surface` | `#FFFDF9` | Cartes et formulaires |
| `--primary` | `#A5660B` | Actions |
| `--gold` | `#B77B17` | Accents |
| `--gold-soft` | `#F8E9CB` | Badges |
| `--line` | `#E3DDD2` | Bordures |
| `--muted` | `#726F69` | Texte secondaire |

Le **mode sombre** est actif par défaut, avec les adaptations de `src/theme.css` :

| Token | HEX | Usage |
| --- | --- | --- |
| `--paper` | `#101B20` | Fond de page |
| `--surface` | `#19292F` | Cartes et fenêtres |
| `--chrome` | `#0D171C` | Menus et bandeaux |
| `--field` | `#122127` | Champs de formulaire |
| `--ink` | `#F5F0E7` | Texte principal |
| `--muted` | `#A9B4B9` | Texte secondaire |
| `--primary`, `--gold` | `#D9A441` | Actions et accents |
| `--line` | `#30434B` | Bordures |

Le bouton soleil/lune est disponible sur les pages publiques, les écrans de compte et de choix du profil ainsi que dans la barre de l’espace académique. `src/theme.js` applique la préférence avant les styles et le rendu de l’application, pour éviter un flash clair. Le choix est conservé sous `campusconnect-theme` dans le stockage local du navigateur et synchronisé entre les onglets. Si le stockage est indisponible, la bascule reste utilisable pendant la visite. Elle ne relance aucun appel à l’API et ne recrée pas les formulaires.

Les fenêtres de détail, les tableaux, les états d’erreur, les documents, les discussions et la carte suivent le même thème. L’impression de l’EDT utilise un fond clair. Ce changement ne modifie pas la base Supabase et n’intègre aucune donnée d’exemple des maquettes.

Les informations proviennent de la base. Aucun compteur ou compte de démonstration n’est inventé. La mise en page s’adapte au mobile ; les contrôles restent accessibles au clavier et les contenus utilisateur sont échappés.

Les tableaux de bord et les menus dédiés au personnel sont décrits dans [le guide des espaces Enseignant et Organisateur](ESPACES_PERSONNELS.md). Les actions pédagogiques suivent les affectations ; les organisateurs gèrent leurs propres événements et publient les actualités de vie étudiante.

## Configuration Supabase

Conserver les migrations existantes : `20261111000100_existing_schema.sql` pour le socle et `20261116000100_campus_services.sql` pour les services. Elles restent applicables aux tables CampusConnect existantes. Les tables historiques de demandes et de notifications ne sont plus utilisées par les écrans ; elles sont préservées pour ne pas perdre d’anciennes données.

L’accès visiteurs utilise les tables existantes et accepte aussi l’ancien schéma de `news_posts` sans colonne de catégorie. Cette extension n’exige pas de nouvelle migration SQL sur une base déjà configurée. Les nouveaux fichiers ou thèmes ne modifient pas automatiquement la base distante.

Dans **Authentication → URL Configuration**, autoriser `http://localhost:8787` pour les tests et l’URL du site déployé. Les nouveaux profils reçoivent le rôle étudiant ; les profils enseignants, chefs de département et organisateurs sont attribués par l’établissement, puis vérifiés côté serveur.

Le bucket `campus-files` doit rester privé. Les uploads acceptent PDF, PNG, JPEG et WebP, 10 Mo maximum, avec contrôle du contenu. Les téléchargements vérifient la propriété ou l’audience du document.

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
- Aucun centre de notifications ni demande d’accès aux profils n’est exposé. Les rôles restent attribués par l’établissement.
- La liste des participants se recharge automatiquement toutes les 5 secondes pendant son ouverture, avec un contrôle serveur des droits à chaque lecture, et avec « Actualiser maintenant ». Aucun abonnement Supabase Realtime n’est configuré.
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

Avant une livraison, essayer avec de vrais comptes : confirmation email, connexion sans sélection de filière, inscription avec email universitaire, profils autorisés, téléchargement privé, cycle de réclamation, partage inter-filières, réservation Marketplace et navigation mobile/clavier. Cette étape valide la configuration du projet distant, qui n’est pas modifiée automatiquement par un `git pull`.
