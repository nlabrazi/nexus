# Journaux et diagnostic Nexus

Les événements opérationnels utilisent le logger commun (`src/logging/logger.ts`).
Chaque ligne JSON contient timestamp, niveau, composant et opération ; les tâches
ajoutent fournisseur, modèle, état et durée lorsqu’ils sont connus. `debug` est
activable avec `NEXUS_LOG_LEVEL=debug` (défaut : `info`).

Core et Desktop écrivent dans `~/.nexus/logs/core` et `~/.nexus/logs/desktop`.
L’extension utilise son répertoire de logs VS Code et le canal **Nexus Logs**.
`NEXUS_LOG_DIR` remplace la racine. Dans Docker, le volume `.nexus` existant
conserve les logs Core. Pour plusieurs processus du même rôle sur une machine,
utiliser une racine distincte par instance.

Chaque dossier contient `nexus.log` et `error.log` (erreurs et avertissements avec
exception). Chaque fichier est limité à 1 Mo avec trois archives `.1` à `.3`.
Les dossiers/fichiers créés ont les permissions 0700/0600 sur Unix. Une panne disque
désactive ce fichier de sortie jusqu’au redémarrage, sans interrompre les tâches ;
la sortie terminal reste active.

Ne jamais passer un prompt, une réponse ou une sortie brute de processus au logger.
Les champs admis sont explicites. Les messages d’exceptions externes sont remplacés
par un message neutre ; leur type et les frames de stack restent disponibles.
`DiagnosticError` est réservé aux messages maîtrisés, sans contenu utilisateur.
Les secrets connus (environnement, jetons Telegram/Core) sont masqués en complément.
Ce filtre ne remplace pas la règle d’exclusion des contenus sensibles.

Les réponses explicites des commandes CLI (aide, résultat demandé, appairage) ne
sont pas recopiées dans ces fichiers. Core nécessite désormais un jeton configuré
via `NEXUS_CORE_AUTH_TOKENS` ou `--token` : aucun jeton temporaire n’est imprimé.

`Nexus: Diagnostics` ouvre un résumé dans le canal de sortie de l’extension.
`/diagnostics` fournit le même format à l’utilisateur Telegram appairé, sans
remplacer `/status`. Un modèle configuré n’est pas une preuve de disponibilité ;
le diagnostic l’indique. Depuis Core, les états des processus agents distants sont
signalés comme non vérifiés. La dernière erreur est celle du processus interrogé.
