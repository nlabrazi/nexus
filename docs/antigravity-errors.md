# Gestion des erreurs Gemini Antigravity

Nexus capture et gère de manière robuste l'ensemble des cas d'erreur pouvant survenir lors des interactions avec le processus Gemini Antigravity (`agy`).

## Codes d'erreur et messages

| Code | Situation | Comportement et message utilisateur |
| --- | --- | --- |
| `not_installed` | Binaire `agy` absent ou inaccessible (`ENOENT`). | *« Antigravity (agy) est introuvable. Vérifiez « agy --version » dans le terminal de VS Code, puis relancez VS Code après installation. »* |
| `process_failed` | Crash inopiné du processus `agy`, EOF prématuré ou flux cassé. | *« La connexion au processus Antigravity a été perdue. Vérifiez les modifications éventuelles avant une nouvelle instruction. La session sera reprise si elle est encore disponible. »* |
| `turn_timeout` | Le turn dépasse 120 secondes sans réponse finale. | Nexus ferme le flux, tue le sous-processus et avertit l'utilisateur : *« Le délai de 120 s est dépassé et la fin du turn n’a pas été confirmée. Nexus a fermé la connexion et demandé l’arrêt du processus. »* |
| `stream_timeout` | Aucun événement NDJSON reçu sur stdout pendant 60 secondes. | Le flux est considéré comme figé et la requête est annulée. |
| `stopped` | Annulation manuelle par l'utilisateur via `/stop`. | Le processus est arrêté immédiatement, les commandes enfants sont terminées, et l'identifiant de session est préservé. |
| `turn_failed` | Événement `result` reçu avec le statut `"ERROR"`. | L'erreur retournée par Antigravity est restituée fidèlement et littéralement. |
| `empty_response` | Événement `result` reçu sans contenu textuel ni delta. | *« Antigravity a terminé son tour sans émettre de réponse textuelle. »* |
| `session_lost` | Impossible de recharger ou réattacher une session demandée. | *« La conversation Antigravity « id » est introuvable ou n’est plus accessible. Utilisez /resume <id> pour la reprendre, ou /new pour repartir avec une nouvelle session. »* |
| `protocol_error` | Ligne NDJSON invalide ou tronquée émise par le processus. | Nexus ignore les lignes parasites ou signale une erreur de formatage. |

## Principes de sécurité et de reprise

1. **Aucun rejeu automatique** :
   En cas d'échec ou de perte de processus, Nexus ne relance JAMAIS automatiquement une invite. Cela évite d'exécuter deux fois des commandes modifiant le code ou l'environnement.

2. **Préservation de l'identifiant** :
   Même en cas de plantage d'un tour, l'identifiant `conversation_id` reste mémorisé. Le prompt suivant tente automatiquement une reprise (`--conversation <id>`).

3. **Protection des buffers** :
   Les chunks partiels sur stdout sont bufferisés et découpés par saut de ligne (`\n`) pour garantir que seules des lignes NDJSON complètes soient parsées.
