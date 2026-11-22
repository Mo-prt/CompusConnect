# Espaces Enseignant et Organisateur

Les espaces utilisent les comptes Supabase Auth, les profils et les rôles existants. Le bouton **Changer d’espace** affiche uniquement les profils autorisés. Le choix est conservé pour ce compte dans l’onglet et vérifié à nouveau après chargement des droits.

## Espace enseignant / chef de département

- `#teaching` : tableau de bord des enseignements, publications et réclamations à traiter.
- `#teaching-modules` : modules affectés, filtres par filière et semestre, publication d’une annonce ou d’un document dans un module autorisé.
- `#teaching-schedule` : séances des emplois du temps courants, navigation par semaine, filtres et impression.
- Annonces : publication ciblée sur les filières du module.
- Documents : téléversement et publication de cours, TD, TP et autres supports autorisés ; fichiers PDF ou images, 10 Mo maximum.
- Réclamations : consultation, échanges et traitement des dossiers dont le personnel est responsable. Les réclamations pédagogiques avec module sont affectées à son responsable actif et autorisé ; le chef compétent voit aussi celles de son département.

L’enseignant retrouve ses affectations même si elles concernent plusieurs filières. Une séance explicitement attribuée à un autre enseignant n’apparaît pas dans son EDT personnel. Le chef de département voit les séances courantes de son département. L’administration conserve son périmètre global.

Le format enseignant fourni par l’équipe est **initiale.nom@usms.ma**, par exemple `a.maless@usms.ma`. La connexion exige l’email et le mot de passe, sans sélectionner de filière. L’inscription publique reste celle des étudiants au format `prenom.nom@usms.ac.ma` ; les comptes de personnel sont préparés par l’établissement. Le format de l’email ne donne aucun rôle à lui seul.

## Espace organisateur

- `#organizer` : événements gérables par le compte, compteurs réels, recherche et filtres Brouillons / Publiés / Annulés / Terminés.
- Création, modification et publication d’un événement ; ciblage de plusieurs filières, date, horaire, lieu et capacité facultative.
- Annulation logique avec conservation des inscriptions.
- Liste nominative des participants, réservée au propriétaire de l’événement ou à l’administrateur.
- Publication d’actualités de vie étudiante, visibles sur les pages publiques.
- Accès aux annonces communautaires Lost & Found ; les actions de clôture restent celles de l’auteur ou de l’administrateur.

La liste des participants s’actualise automatiquement **toutes les 5 secondes**, et propose aussi **Actualiser maintenant**. La lecture passe par l’API sécurisée existante et utilise les dernières inscriptions enregistrées. Les requêtes sont suspendues lorsque l’onglet est masqué et arrêtées à la fermeture de la fenêtre ou lors d’un refus d’accès. Il s’agit d’un suivi automatique par lectures périodiques ; aucun abonnement Supabase Realtime n’est activé par ce changement.

## Activer les comptes dans Supabase

Cette version ne modifie aucun compte réel automatiquement. Les adresses données en exemple dans ce guide ne sont pas des comptes à créer.

1. Dans **Authentication → Users**, retrouver le compte existant. Pour un nouveau membre du personnel, le créer avec la procédure de l’établissement, puis copier son **User UID**.
2. Dans **Table Editor → profiles**, retrouver ou créer son profil : `id` égal au User UID, nom, prénom, email, filière de référence et `department_id`. Le compte doit avoir le statut `active` pour accéder à l’application.
3. Dans **roles**, relever l’ID correspondant au code voulu. Les codes sont `teacher`, `department_head` et `organizer` ; les IDs dépendent de la base.
4. Dans **user_roles**, ajouter la relation `user_id` = ID du profil et `role_id` = ID du rôle. Un compte peut cumuler, par exemple, `student` et `organizer`, ou `teacher` et `organizer`.
5. Pour un enseignant, dans **modules**, renseigner `responsible_teacher_id` avec son ID. Les relations **program_modules** déterminent les filières des modules. Sans affectation, aucune publication de cours n’est autorisée.
6. Dans **timetables**, vérifier que l’EDT voulu est courant (`is_current = true`). Dans **timetable_sessions**, renseigner le module, la salle et `teacher_id`. Si ce dernier est vide, le responsable du module est utilisé comme référence pour l’EDT enseignant.
7. Pour un chef de département, vérifier `profiles.department_id` et le rôle `department_head`. Renseigner aussi **department_heads** pour sa présentation publique, sa permanence et ses dates de fonction.
8. Se connecter au site et sélectionner l’espace autorisé. **Actualiser** recharge les droits et les affectations ; une nouvelle connexion permet de reprendre le parcours complet.

Pour vérifier les relations sans les modifier, utiliser le SQL Editor :

```sql
select p.id, p.email, p.first_name, p.last_name, p.account_status,
       coalesce(array_agg(r.code) filter (where r.code is not null), '{}') as roles
from public.profiles p
left join public.user_roles ur on ur.user_id = p.id
left join public.roles r on r.id = ur.role_id
group by p.id, p.email, p.first_name, p.last_name, p.account_status
order by p.email;
```

Les migrations déjà présentes restent nécessaires au socle du projet. **Cette configuration ne demande aucune nouvelle migration**, aucun nouveau secret et aucun changement des mots de passe existants.

## Recette

1. Enseignant : se connecter avec son adresse de personnel ; vérifier ses modules et son EDT, publier une annonce et un PDF, puis ouvrir et traiter une réclamation de son périmètre.
2. Organisateur : enregistrer un brouillon, le modifier, le publier et ouvrir ses participants. Depuis un autre navigateur, inscrire puis désinscrire un étudiant ; constater le changement lors de l’actualisation automatique suivante. Publier une actualité et vérifier sa lecture publique.
3. Compte multirôle : basculer entre les espaces, puis recharger une page ; vérifier que le choix reste autorisé et que les menus suivent l’espace actif.
4. Étudiant : vérifier que les routes de personnel ne donnent accès ni aux publications, ni aux participants, ni au traitement de réclamations.

Les tests automatisés utilisent les vraies fonctions SQL dans PGlite et des transports Auth/PostgREST simulés. La configuration des comptes et la recette avec de vrais utilisateurs se font dans le projet Supabase de l’équipe.
