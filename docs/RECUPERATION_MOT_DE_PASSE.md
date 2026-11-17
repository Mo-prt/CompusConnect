# Mot de passe oublié

Depuis **Se connecter → Mot de passe oublié ?**, l’utilisateur saisit son email. Supabase Auth envoie un lien temporaire. Ce lien ouvre un formulaire avec le nouveau mot de passe et sa confirmation, puis l’utilisateur revient à la connexion.

Cette fonctionnalité complète la gestion des comptes à la demande de l’équipe. Elle ne modifie ni les profils, ni les rôles, ni les tables académiques. **Aucune nouvelle migration SQL ni variable secrète n’est nécessaire.**

## Configuration dans Supabase

1. Ouvrir le projet dans le tableau de bord Supabase.
2. Aller dans **Authentication → URL Configuration**.
3. Dans **Redirect URLs**, ajouter les adresses locales utilisées :

   ```text
   http://localhost:8787/api/auth/recovery/callback
   http://127.0.0.1:8787/api/auth/recovery/callback
   ```

4. Ajouter aussi l’adresse HTTPS du site déployé, avec le même chemin : `https://votre-domaine/api/auth/recovery/callback`. Conserver l’URL racine du site dans **Site URL**.
5. Dans le modèle d’email **Reset Password** d’Authentication, conserver le lien Supabase `{{ .ConfirmationURL }}`. Il vérifie le lien puis revient au callback avec un code. Un lien statique vers `#reset-password` ne suffit pas.
6. Vérifier la configuration d’envoi d’emails. Le service par défaut de Supabase impose des restrictions de destinataires et de fréquence ; configurer un fournisseur SMTP pour les utilisateurs réels.

Ces réglages sont faits dans Supabase. Un `git pull` met à jour le code local mais ne change pas la configuration distante d’Authentication.

## Essai local

Dans le dossier du projet, arrêter le serveur avec `Ctrl+C`, puis :

```powershell
git pull --rebase origin main
npm.cmd run build
npx.cmd wrangler@4 dev dist/server/index.js --port 8787
```

Les fichiers `.env` et `.dev.vars` conservent la configuration serveur existante et restent hors de Git.

1. Ouvrir `http://localhost:8787/#login` et cliquer sur **Mot de passe oublié ?**.
2. Saisir l’email d’un compte Supabase Auth auquel vous avez accès.
3. Ouvrir le **dernier lien reçu dans le même navigateur**. Éviter le navigateur intégré de la messagerie ; copier le lien dans le navigateur du site si nécessaire. Ne pas alterner entre `localhost` et `127.0.0.1`.
4. Saisir deux fois un nouveau mot de passe de 8 à 128 caractères, compatible avec la politique du projet Supabase.
5. Vérifier que la nouvelle connexion fonctionne avec l’email et le nouveau mot de passe, sans sélectionner de filière. L’ancien mot de passe doit être refusé.

## Liens et erreurs

- Le navigateur conserve une preuve de demande pendant **20 minutes**. Le lien peut expirer plus tôt selon Supabase. Après ouverture, le formulaire est utilisable pendant au plus **10 minutes**. Un lien expiré ou déjà utilisé permet de demander un nouvel email.
- La réponse après la demande reste identique pour une adresse connue ou inconnue. Elle ne confirme pas l’existence d’un compte ni la livraison effective du message.
- Si aucun email n’arrive, vérifier les indésirables, les restrictions d’envoi et les journaux Auth/SMTP dans Supabase. En cas de trop nombreuses demandes, attendre avant de réessayer.
- Si le retour arrive au mauvais endroit, vérifier les **Redirect URLs**, le modèle d’email et l’adresse du site utilisée au moment de la demande.
- Un changement de navigateur, une nouvelle demande ou la suppression des cookies peut invalider le parcours. Recommencer depuis la connexion.

## Fonctionnement et vérification

Le Worker utilise **PKCE** : le code reçu au callback est échangé côté serveur. Les preuves temporaires sont signées et placées dans des cookies HttpOnly et Secure. Aucun jeton Supabase n’est renvoyé dans le JSON ni stocké par le JavaScript du frontend. Le callback ne crée pas de session CampusConnect et n’accorde aucun rôle.

Après le changement, les cookies locaux sont effacés et une déconnexion globale Supabase est demandée. En cas d’échec de cette dernière, l’interface indique que le mot de passe a été changé mais que la fermeture des autres sessions n’a pas pu être confirmée. Même après une déconnexion globale, les jetons JWT déjà émis peuvent rester valides jusqu’à leur expiration.

Les tests automatisés vérifient le parcours avec un fournisseur Auth simulé, les cookies signés, les expirations, les erreurs, les protections d’origine et les écrans dans un DOM simulé. Ils ne remplacent pas un essai avec une vraie messagerie et la configuration du projet Supabase.
