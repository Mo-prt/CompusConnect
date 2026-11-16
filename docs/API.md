# API CampusConnect

Préfixe : `/api`. JSON UTF-8 pour les écritures, sauf les uploads binaires. Authentification par cookies HttpOnly ; aucun jeton ne doit être stocké dans le frontend. Les droits sont relus en base pour chaque requête. Les identifiants métier sont des UUID.

## Accès et compte — F01

| Méthode et chemin | Contenu / résultat |
| --- | --- |
| `GET /auth/me` | `{user}` ou `{user:null}`. |
| `POST /auth/register` | `{name,email,password,program}`. `program` est le code de filière. Peut répondre `202` avec `requiresEmailConfirmation`. |
| `POST /auth/login` | `{email,password,program}`. Les rôles sont lus dans les tables du projet. |
| `POST /auth/logout` | Révoque la session locale et efface les cookies. |
| `PUT /profile` | `{name,program}` ; ne permet pas de modifier les rôles. |

## Lecture de l’espace — F01 à F08

`GET /bootstrap?program=<code>&semester=<UUID-ou-S9>` fournit les références, modules, EDT et événements du socle.

`GET /campus` exige un compte actif. Il fournit uniquement les collections accessibles : `modules`, `announcements`, `documents`, `library`, `complaints`, `news`, `lost`, `spaces`, `resources`, `locations`, `listings`, `categories`, `transactions`, `recommendations`. Les modules comportent `writable`, les espaces `joined` et `memberCount`.

`unavailable` identifie les tables absentes lors d’un déploiement incomplet. Une erreur de transport ou de permissions n’est pas convertie silencieusement en collection vide. Appliquer les migrations avant la recette complète.

## Pédagogie, ressources et fichiers — F02, F04, F06

| Méthode et chemin | Corps / droits |
| --- | --- |
| `POST /announcements` | `{module_id,title,body}`. Enseignant responsable, chef compétent ou administrateur ; cibles déduites des filières du module. |
| `POST /documents` | `{module_id,file_id,title,document_type,description}`. Mêmes droits académiques ; fichier appartenant à l’auteur. |
| `POST /library` | `{title,resource_type,authors,abstract,external_url,file_id,visibility}`. Au moins fichier ou URL HTTP(S). Audiences : `all_students`, `selected_programs` (filière du compte), `private`. |
| `POST /library/:id/view` | Vérifie l’audience, enregistre la consultation et retourne `{file_id,url}`. |
| `POST /uploads?name=<nom>` | Octets du fichier dans le corps ; `Content-Type` PDF/PNG/JPEG/WebP. Retour `{file}`. 10 Mo maximum et signature vérifiée. |
| `GET /files/:id` | Téléchargement après contrôle de propriété/audience/référence métier. `?inline=1` autorisé uniquement pour les images prises en charge. |

Types de documents : `course`, `td`, `tp`, `exam`, `handout`, `other`. Types de bibliothèque : `book`, `article`, `project_report`, `course_support`, `website`, `other`.

Un upload isolé reste privé. Il devient téléchargeable par d’autres comptes lorsqu’il est lié explicitement à un contenu qu’ils peuvent consulter.

## Réclamations — F04

| Méthode et chemin | Corps / droits |
| --- | --- |
| `POST /complaints` | `{subject,description,complaint_type,module_id?}`. Étudiant. Type `pedagogical` ou `technical`. |
| `GET /complaints/:id` | `{complaint,messages}`. Auteur, responsable désigné, chef compétent pour une réclamation pédagogique, administrateur. |
| `POST /complaints/:id/messages` | `{message}`. Compte autorisé sur la réclamation. |
| `PATCH /complaints/:id` | `{status,resolution_note}`. Personnel autorisé ; `submitted → under_review/rejected`, `under_review → resolved/rejected`. Les états terminaux ne sont pas réouverts par cette route. |

## Événements — F03

| Méthode et chemin | Corps / droits |
| --- | --- |
| `POST /events`, `PUT /events/:id` | `{title,description,category,status,date,endDate,time,endTime,location,capacity,programs}`. Organisateur propriétaire ou administrateur. |
| `DELETE /events/:id` | Annulation logique ; inscriptions conservées. |
| `POST /events/:id/register` | Inscription étudiant ; vérifie date, filière, statut, doublon et capacité sous verrou. |
| `DELETE /events/:id/register` | Désinscription conservant la ligne d’historique. |
| `GET /events/:id/participants` | Organisateur propriétaire ou administrateur seulement. |

Les dates/heures de formulaire suivent `Africa/Casablanca`. `capacity:null` signifie absence de limite. `programs:[]` ouvre l’événement à toutes les filières.

## Communauté et services — F05, F06, F08

| Méthode et chemin | Corps / droits |
| --- | --- |
| `POST /news` | `{title,content,category,cover_file_id?}`. Enseignant, chef, organisateur ou administrateur. Catégorie `campus`, `research`, `clubs`, `partners`. |
| `POST /lost-found` | `{title,item_type,description,location_text,item_date?,contact_info,image_file_id?}`. Type `lost` ou `found`. |
| `PATCH /lost-found/:id` | `{status:"returned" ou "closed"}`. Auteur ou administrateur. |
| `POST /collaboration` | `{title,description,topic}`. Crée un projet ouvert. |
| `GET /collaboration/:id` | `{space,resources,discussions}`. Un espace ouvert est consultable par les comptes actifs ; un espace clos par ses membres/créateur/admin. |
| `POST /collaboration/:id/join` | Adhésion à un projet ouvert. |
| `POST /collaboration/:id/discussions` | `{message}`. Membre, créateur ou administrateur ; projet ouvert. |
| `POST /collaboration/:id/resources` | `{title,description,file_id?,library_resource_id?}`. Mêmes droits ; la ressource liée doit être visible à toutes les filières. |
| `PATCH /collaboration/:id` | Clôture par le créateur ou administrateur ; historique conservé. |
| `POST /locations` | `{name,location_type,building,description,map_x,map_y}`. Administrateur. Coordonnées schématiques en pourcentage de 0 à 100. |

## Marketplace — F08

| Méthode et chemin | Corps / droits |
| --- | --- |
| `POST /marketplace` | `{title,description,listing_type,item_condition,price?,category_id?,image_file_id?}`. Étudiant ou administrateur. Devise MAD ; aucun paiement. |
| `GET /marketplace/:id/images` | Images d’une offre accessible. |
| `POST /marketplace/:id/request` | Demande sur une offre disponible appartenant à un autre compte ; doublons actifs refusés. |
| `PATCH /marketplace/transactions/:id` | `{status}`. Propriétaire : accepter/refuser une demande ou terminer une demande acceptée. Demandeur : annuler sa demande active. |
| `PATCH /marketplace/:id` | `{status:"completed" ou "withdrawn"}`. Propriétaire ou administrateur ; clôture atomique et conservation des transactions. |

Types d’offres : `sale`, `loan`, `donation`, `exchange`. États du matériel : `new`, `very_good`, `good`, `acceptable`, `not_applicable`. Les transitions Marketplace utilisent des fonctions SQL qui verrouillent d’abord l’offre pour empêcher plusieurs acceptations concurrentes.

## Assistant et suggestions — F07

| Méthode et chemin | Corps / résultat |
| --- | --- |
| `GET /assistant` | Conversations du compte courant. |
| `GET /assistant/:id` | Messages et citations d’une conversation appartenant au compte. |
| `POST /assistant` | `{question,conversation_id?}` → `{conversation_id,message,mode}`. Mode `source-search` par défaut, `rag` si le service externe est configuré. |
| `POST /assistant/:messageId/feedback` | `{is_relevant:boolean}` sur une réponse de sa conversation. |
| `POST /recommendations` | Enregistre jusqu’à trois suggestions accessibles, calculées par correspondance avec les modules. |
| `POST /recommendations/:id/feedback` | `{is_relevant:boolean}` sur une recommandation du compte courant. |

Le contrat du futur service FastAPI et les limites du mode de recherche sont décrits dans [le guide d’adaptation](DESIGN_ET_FONCTIONNALITES.md#fpk-gpt-et-recommandations).

## Périmètre

Les connexions tierces, les demandes de rôles et un centre de notifications ne font pas partie des écrans exposés. Leurs anciennes routes applicatives sont retirées. Les tables et migrations historiques sont conservées pour préserver les bases déjà configurées.

## Codes HTTP

`200/201` succès ; `202` confirmation email attendue ; `400` entrée invalide ; `401` connexion requise/expirée ; `403` droits insuffisants ; `404` élément absent/inaccessible ; `409` conflit de capacité, de doublon ou de statut ; `413` taille dépassée ; `415` format refusé ; `429` limite Auth ; `502/503` service distant ou configuration indisponible.

Les erreurs publiques retournent `{error:"message"}` sans clé, SQL ni réponse brute du fournisseur. Les commandes de diagnostic fournissent les codes techniques sans afficher les secrets.
