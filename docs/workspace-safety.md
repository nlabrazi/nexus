# Sécurité workspace et Git

Avant de créer/reprendre une session et avant chaque prompt, Nexus vérifie :

- Un seul dossier ouvert, existant, accessible par une URI `file`, dans un workspace approuvé par VS Code. La racine du système de fichiers est refusée.
- Pour un dépôt Git : le dossier ouvert est sa racine, y compris pour un worktree. Un sous-dossier, un dépôt bare et HEAD détachée sont refusés.
- Aucun fichier du projet ni notebook non sauvegardé dans cette fenêtre. Les documents sans nom non sauvegardés bloquent aussi. Les modifications **sauvegardées mais non commitées**, les fichiers staged et les fichiers non suivis restent autorisés.
- Aucune opération Git en cours : merge, rebase, git am, cherry-pick, revert, séquence Git, bisect ou verrou d’index ; aucun conflit dans l’index.
- La branche n’est pas protégée. Par défaut : `main` et `master`.

Le réglage VS Code `nexus.git.protectedBranches` accepte une liste de noms exacts, sensibles à la casse. Une liste vide désactive cette protection.

Un projet sans Git est accepté si Git confirme qu’il ne s’agit pas d’un dépôt et qu’aucun marqueur `.git` cassé ne rend la détection ambiguë. Git absent, inaccessible ou trop lent bloque la demande avec une indication de diagnostic. Chaque commande de vérification Git a un délai maximal de cinq secondes.

La session mémorise la racine canonique, le répertoire Git et la branche. Un changement de branche bloque sa réutilisation : revenez à la branche précédente, ou choisissez explicitement `/new` ou `/resume <id>`. Les commits sur la même branche n’invalident pas la session. `/status` affiche la **branche de la session**, sans lancer de commande Git : elle peut donc différer de la branche courante après un changement manuel.

Les contrôles ne modifient ni fichiers, ni index, ni branche. Les variables d’environnement qui redirigent Git vers un autre dépôt sont retirées des vérifications et du processus Codex. Les commandes locales de session/prompt utilisent les mêmes contrôles que Telegram.

## Changer de branche

Depuis Telegram, même lorsque la branche courante est `master` ou `main` :

```text
/branches
/switch staging
```

`/branches` liste les branches locales et les références distantes déjà connues du dépôt. La branche courante est marquée `→`, les branches protégées `🔒`. Aucun fetch réseau n’est lancé : si une branche distante manque, actualisez les références depuis Git dans VS Code.

Utilisez le nom exact affiché. `/switch staging` sélectionne la branche locale ; `/switch origin/staging` crée une branche locale `staging` avec suivi de `origin/staging`. Si la branche locale existe déjà, sélectionnez-la directement. Aucun reset ni remplacement de branche existante n’est effectué.

La commande **Nexus: Switch Branch** propose la même sélection dans VS Code. Les branches protégées restent visibles mais leur sélection est refusée. La protection de la branche de départ ne bloque pas le passage vers une branche de travail.

Le changement exige un dépôt sans modifications locales (y compris staged et fichiers non suivis), sans document non sauvegardé, conflit ou opération Git en cours. Faites un commit ou un stash vous-même si nécessaire. Aucun stash automatique ni changement forcé ; Git refuse aussi d’écraser un fichier ignoré présent localement. Les autres contrôles du workspace restent applicables, y compris le refus de HEAD détachée.

Une requête Codex et un changement de branche ne peuvent pas s’exécuter simultanément via Nexus, depuis Telegram comme depuis VS Code. `/stop` concerne Codex et n’annule pas une commande Git en cours. Les actions Git manuelles depuis un autre outil restent hors de ce verrou.

Si une session était déjà sélectionnée sur l’ancienne branche, utilisez ensuite `/new` ou `/resume <id>` avant d’envoyer un prompt sur la nouvelle branche. Le changement ne lance pas Codex et ne réassocie pas automatiquement la conversation.

## Tester soi-même

1. Dans le projet Nexus : `npm run test:unit`, puis `npm run compile`. Attendu : aucun échec.
2. Relancer le débogage avec **F5**, puis ouvrir **un seul dépôt de test à sa racine** dans l’Extension Development Host. Utiliser une branche de travail différente de `main` et `master`, par exemple créée avec `git switch -c test/nexus-safety`. Conserver l’appairage Telegram habituel.
3. Envoyer `/codex Réponds simplement OK`, puis `/status`. Attendu : une réponse et la branche associée à la session.
4. Désactiver Auto Save si nécessaire, modifier un fichier sans sauvegarder, puis renvoyer le prompt. Attendu : refus signalant le fichier non sauvegardé. Faire `Ctrl+S` et réessayer : accepté, même sans commit.
5. Sur ce dépôt de test, passer sur une branche `main` ou `master` existante. Envoyer le prompt : refus pour branche protégée, avec indication de `/branches` et `/switch`. Envoyer `/branches`, puis `/switch test/nexus-safety` : retour à la branche de travail. Vérifier également le sélecteur **Nexus: Switch Branch** dans VS Code.
6. Créer une autre branche de travail avec `git switch -c test/nexus-other`. Envoyer le prompt : refus pour changement de contexte. Envoyer `/new`, puis le prompt : accepté ; `/status` affiche la nouvelle branche. Une reprise explicite avec `/resume <id>` permet aussi d’associer la conversation choisie à la branche courante, dans le même projet.
7. Ajouter un second dossier dans la fenêtre. Attendu : `/status` signale la cible ambiguë et `/codex` est bloqué. Retirer ce second dossier.
8. Ouvrir uniquement un sous-dossier du dépôt : `/codex` doit demander d’ouvrir la racine Git. Rouvrir ensuite la racine.

Les tests automatisés créent et suppriment leurs propres dépôts temporaires. Ils couvrent aussi un vrai conflit d’index, les marqueurs d’opérations Git, HEAD détachée, les worktrees, les liens symboliques, Git absent/timeout, le workspace absent, un `.git` cassé, les changements d’éditeur pendant le contrôle et les changements de branche pendant la création de session. Aucun bot réel n’est contacté.

## Limites

Il s’agit de contrôles avant lancement, pas d’un verrou Git pendant toute l’exécution. Un changement manuel de branche après le lancement, ou une commande Git exécutée par Codex pendant le turn, n’est pas empêché par ces contrôles. Les fichiers non sauvegardés d’une autre fenêtre VS Code ne sont pas visibles. L’association session/branche est restaurée après redémarrage via [la persistance du workspace](session-persistence.md), puis vérifiée avant toute reprise.
