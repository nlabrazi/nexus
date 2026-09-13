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

## Tester soi-même

1. Dans le projet Nexus : `npm run test:unit`, puis `npm run compile`. Attendu : aucun échec.
2. Relancer le débogage avec **F5**, puis ouvrir **un seul dépôt de test à sa racine** dans l’Extension Development Host. Utiliser une branche de travail différente de `main` et `master`, par exemple créée avec `git switch -c test/nexus-safety`. Conserver l’appairage Telegram habituel.
3. Envoyer `/codex Réponds simplement OK`, puis `/status`. Attendu : une réponse et la branche associée à la session.
4. Désactiver Auto Save si nécessaire, modifier un fichier sans sauvegarder, puis renvoyer le prompt. Attendu : refus signalant le fichier non sauvegardé. Faire `Ctrl+S` et réessayer : accepté, même sans commit.
5. Sur ce dépôt de test, passer sur une branche `main` ou `master` existante. Envoyer le prompt : refus pour branche protégée. Revenir sur la branche de travail.
6. Créer une autre branche de travail avec `git switch -c test/nexus-other`. Envoyer le prompt : refus pour changement de contexte. Envoyer `/new`, puis le prompt : accepté ; `/status` affiche la nouvelle branche. Une reprise explicite avec `/resume <id>` permet aussi d’associer la conversation choisie à la branche courante, dans le même projet.
7. Ajouter un second dossier dans la fenêtre. Attendu : `/status` signale la cible ambiguë et `/codex` est bloqué. Retirer ce second dossier.
8. Ouvrir uniquement un sous-dossier du dépôt : `/codex` doit demander d’ouvrir la racine Git. Rouvrir ensuite la racine.

Les tests automatisés créent et suppriment leurs propres dépôts temporaires. Ils couvrent aussi un vrai conflit d’index, les marqueurs d’opérations Git, HEAD détachée, les worktrees, les liens symboliques, Git absent/timeout, le workspace absent, un `.git` cassé, les changements d’éditeur pendant le contrôle et les changements de branche pendant la création de session. Aucun bot réel n’est contacté.

## Limites

Il s’agit de contrôles avant lancement, pas d’un verrou Git pendant toute l’exécution. Un changement manuel de branche après le lancement, ou une commande Git exécutée par Codex pendant le turn, n’est pas empêché par ces contrôles. Les fichiers non sauvegardés d’une autre fenêtre VS Code ne sont pas visibles. L’association session/branche reste en mémoire et disparaît au redémarrage de l’extension ; la persistance sera traitée séparément.
