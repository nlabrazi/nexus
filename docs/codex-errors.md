# Gestion des erreurs Codex

Les erreurs remontent dans Telegram et dans les commandes VS Code avec un message
en français. Les instructions ne sont jamais rejouées automatiquement : un échec
ou une réponse vide ne prouve pas qu'aucune action n'a eu lieu.

## Comportement

| Situation | Réaction de Nexus |
| --- | --- |
| Commande `codex` absente (`ENOENT`) | Message proposant de vérifier `codex --version` depuis VS Code ; réservation de la requête libérée. |
| Crash, erreur d'un flux, fermeture de stdout | Requête en cours rejetée immédiatement, approbations invalidées et connexion fermée. L'identifiant de session reste mémorisé. |
| Arrêt de Nexus | Promesses en cours rejetées immédiatement, même si le processus n'émet pas d'événement de sortie. |
| RPC sans réponse sous 15 s | Erreur explicite et connexion fermée ; une réponse tardive ne restaure pas la session ni le turn. |
| Turn dépassant 120 s | Approbations annulées, envoi de `turn/interrupt`, puis attente de `turn/completed` pendant cinq secondes au maximum. |
| Interruption sans confirmation | Connexion fermée et arrêt du processus demandé. Le message précise que l'exécution reste incertaine. |
| Turn échoué ou interrompu | Erreur explicite ; le texte partiel n'est pas présenté comme un succès. |
| Réponse finale vide | Erreur explicite ; la session reste utilisable pour une nouvelle instruction volontaire. |
| Session introuvable/non chargée | Identifiant conservé, sélection marquée inactive si elle est concernée ; indication de `/resume <id>` et `/new`. Aucun remplacement automatique. |

Pendant l'interruption, `/status` affiche « interruption en cours ». Le verrou
reste tenu : une nouvelle instruction ou un changement de session est refusé
jusqu'à la fin confirmée, ou jusqu'à la fermeture de la connexion. Un simple
accusé de réception de `turn/interrupt` ne suffit pas à libérer ce verrou.

Les réponses sont collectées par turn et par message. Le texte final complet
fait autorité sur les fragments reçus. Lorsque Codex indique une phase
`final_answer`, les messages `commentary` ne sont pas inclus dans la réponse.
Pour les versions qui n'indiquent pas la phase, Nexus utilise les messages sans
phase. Une réponse composée uniquement de progression est signalée comme vide.

Après un crash, un **nouveau** prompt peut reprendre la session mémorisée avant
d'exécuter la nouvelle instruction. La requête qui a échoué n'est pas répétée.
Les callbacks, erreurs et réponses tardifs de l'ancien processus ne peuvent pas
modifier le nouveau.

## Limites

Fermer la connexion et demander l'arrêt du processus ne garantit pas l'arrêt
de tous ses processus enfants ou d'actions externes déjà lancées. Le message
d'erreur le précise lorsque la fin n'est pas confirmée. Vérifier les fichiers
et les commandes concernées avant de poursuivre ; aucune modification n'est
annulée automatiquement.

La reconnaissance d'une session introuvable utilise le contexte de la RPC et
les messages connus de Codex (`thread/session not found`, `not loaded`,
`no rollout found`, etc.). Le protocole ne fournit pas de code dédié stable.
Une autre formulation reste une erreur RPC, sans création automatique de session.

Les contrôles Git sont décrits dans [le guide workspace](workspace-safety.md).
La commande Telegram `/stop` est décrite dans [le guide d’annulation](telegram-stop.md).
La sauvegarde après rechargement est décrite dans [le guide de persistance](session-persistence.md).

## Tester depuis Telegram

### Préparer

1. Dans le terminal de Nexus, exécuter `npm run compile`.
2. Arrêter l'ancienne session de débogage, relancer **F5**, puis ouvrir un dossier
   de test dans l'Extension Development Host. L'appairage Telegram est conservé.
3. Envoyer `/codex Réponds uniquement OK, sans lire ni modifier de fichier.`.
   Attendu : `OK`. Envoyer `/status` et conserver l'ID de session affiché.

### Session introuvable

Envoyer cet identifiant UUID de test :

```text
/resume 00000000-0000-7000-8000-000000000000
```

Attendu : message d'erreur, puis `/status` montre toujours la session précédente.
Renvoyer `/codex Réponds uniquement OK, sans utiliser d’outil.` : elle fonctionne
toujours. Cette vérification ne supprime aucune conversation existante.

### Timeout de turn

```text
/codex Sans modifier de fichier, exécute sleep 150 et attends sa fin avant de répondre uniquement Terminé.
```

Pendant l'exécution, `/status` montre le turn en cours. Envoyer un second `/codex`
avant sa fin : il doit être refusé. Environ 120 secondes après le début du turn,
Nexus demande l'interruption. Le statut « interruption en cours » peut être très
bref si Codex répond immédiatement.

Attendu : erreur de délai dépassé indiquant une fin confirmée, ou, au plus tard
cinq secondes après le timeout, le message signalant l'absence de confirmation.
Après l'erreur, `/status` ne doit plus rester bloqué sur un turn en cours.

Une fois la fin confirmée, renvoyer `/codex Réponds uniquement OK, sans utiliser
d’outil.` : attendu `OK`, dans la même session. Si la fin n'est pas confirmée,
vérifier d'abord la commande et les fichiers ; la session devra être reprise.
Si Codex termine le test avant 120 secondes, le scénario de timeout n'a pas été
déclenché : utiliser le test simulé ci-dessous pour une vérification déterministe.

### Crash du processus (optionnel, Linux)

Après le prompt `OK` terminé, envoyer `/codex Exécute sleep 60 puis réponds OK.`.
Dans un terminal, identifier le processus app-server de **Nexus dans la fenêtre
de test**, à l'aide de son PID et de son parent :

```sh
ps -eo pid,ppid,args | rg '[c]odex.*app-server.*--stdio'
```

Puis remplacer `PID_NEXUS` par son PID exact :

```sh
kill -KILL PID_NEXUS
```

Attendu : message de connexion perdue rapidement, sans attendre 120 secondes.
`/status` montre le processus arrêté et conserve l'ID de session. Après avoir
vérifié la fin de la commande de test, envoyer un nouveau prompt `OK` : Nexus
tente de reprendre la même session. Si plusieurs processus sont listés et que
celui de Nexus n'est pas identifiable, utiliser le test simulé.

## Tests simulés à lancer soi-même

Les réponses vides et les pannes précises ne sont pas reproductibles de manière
fiable avec une simple instruction au modèle. Les tests utilisent un faux
processus et une horloge contrôlée, sans modifier l'installation de Codex,
contacter Telegram ni attendre deux minutes.

```sh
npm run test:unit
```

Pour ne lancer que les scénarios d'erreur :

```sh
npm run compile-tests
node --test --test-isolation=none out/test/unit/codex-errors.unit.js
```

Attendu : tous les tests passent. Les scénarios couvrent Codex absent, crash,
erreurs de flux, timeout RPC/turn, confirmation ou échec d'interruption, verrou
pendant l'interruption, réponse vide/partielle, session perdue, événements tardifs
et libération de la commande Telegram après une erreur.

## Référence

[Codex App Server — interruption d'un turn](https://learn.chatgpt.com/docs/app-server#interrupt-a-turn).
Les structures ont également été vérifiées à partir des types générés localement
par `codex app-server generate-ts` avec Codex CLI 0.154.0.
