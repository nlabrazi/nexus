# Persistance minimale des sessions

Nexus conserve une seule sélection par workspace VS Code dans `workspaceState` :
version du format, identifiant de session, racine canonique du projet, répertoire
Git et branche associée. Aucun prompt, contenu de fichier, secret, turn ou accord
d’approbation n’est enregistré par ce mécanisme. L’historique de conversation
reste géré par Codex.

Au chargement de l’extension, cette sélection est restaurée comme **inactive**,
sans lancer Codex. `/status` affiche son identifiant et sa branche. La prochaine
instruction explicite lit les métadonnées de la session puis tente sa reprise,
après les contrôles workspace/Git. Aucun ancien prompt n’est rejoué. Une session
introuvable produit une erreur ; aucune nouvelle session n’est créée silencieusement.

`/new` remplace la sélection mémorisée une fois la nouvelle session sélectionnée.
`/resume <id>` mémorise la session reprise. `/stop`, une déconnexion et la fermeture
de l’extension conservent l’association sauvegardée. Un changement de branche
après redémarrage reste bloqué jusqu’au retour à l’ancienne branche ou au choix
explicite de `/new` ou `/resume <id>`.

Les écritures sont attendues avant le prompt et sérialisées pour éviter qu’une
ancienne écriture remplace la sélection la plus récente. Si la sauvegarde échoue,
Nexus garde la sélection en mémoire mais bloque le lancement du prompt avec une
erreur explicite. Une nouvelle tentative réessaie la sauvegarde. Un arrêt pendant
une sauvegarde peut conserver la session déjà sélectionnée, mais ne lance pas le
prompt annulé. Un arrêt brutal de VS Code avant la fin de l’écriture peut laisser
la sélection précédemment sauvegardée.

Un enregistrement absent, mal formé ou d’une version inconnue est ignoré. Le
stockage est propre au workspace tel que VS Code l’identifie : ouvrir le dossier
via un autre workspace `.code-workspace`, le déplacer, supprimer les données de
l’extension ou changer de profil peut ne pas retrouver la même association.
Ce mécanisme ne coordonne pas plusieurs instances simultanées de VS Code.

## Tester depuis le terminal

Dans le terminal du projet Nexus :

```sh
npm run dev:prepare
code --new-window --extensionDevelopmentPath="$PWD" --disable-workspace-trust "$PWD/.nexus-dev/project"
```

Fermer l’ancienne fenêtre de test avant d’en relancer une, afin qu’une seule
instance du bot reste active. L’appairage existant est conservé.

1. Dans Telegram, envoyer `/new`, puis `/codex Réponds uniquement OK.`
2. Envoyer `/status` et noter l’identifiant de session.
3. Fermer **uniquement la fenêtre de test** (`project`), puis la rouvrir avec la
   commande `code` ci-dessus depuis le terminal du projet Nexus.
4. Envoyer `/status` avant tout prompt : même identifiant, processus arrêté,
   session inactive, aucun turn et zéro approbation. Attendu : aucun lancement
   automatique de Codex.
5. Envoyer `/codex Réponds uniquement Bonjour.`, puis `/status` : réponse reçue,
   même identifiant, session active.
6. Envoyer `/new` : l’identifiant change. Fermer/rouvrir la fenêtre et vérifier
   que `/status` retrouve ce nouvel identifiant.

Les tests automatisés (`npm run test:unit`) couvrent le rechargement, la reprise
sans création de session, l’isolation du stockage, les données invalides, le
changement de branche, la session perdue, l’échec d’écriture, l’ordre des écritures
et l’arrêt pendant la sauvegarde. Aucun bot réel n’est contacté.
