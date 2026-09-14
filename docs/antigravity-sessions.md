# Gestion des sessions Gemini Antigravity

Nexus gère le cycle de vie des conversations Antigravity de manière symétrique à Codex, avec persistance locale et contrôle à distance via Telegram.

## Commandes Telegram

| Commande | Comportement |
| --- | --- |
| `/antigravity <instruction>`<br>`/agy <instruction>`<br>`/gemini <instruction>` | Envoie une instruction directement à Antigravity. Réutilise la session sélectionnée ou en démarre une nouvelle. |
| `/backend` | Affiche le backend actif (`Codex` ou `Gemini Antigravity`). |
| `/backend antigravity` | Définit Antigravity comme backend actif pour les commandes génériques (`/new`, `/resume`, `/model`). |
| `/new` | Si Antigravity est actif, crée une nouvelle conversation Antigravity vierge dans le workspace. |
| `/resume <id>` | Si Antigravity est actif, reprend la conversation Antigravity spécifiée. |
| `/status` | Affiche l'état du backend, la session active, le modèle, la branche, les tokens consommés et l'activité en cours. |
| `/stop` | Interrompt la requête Antigravity en cours et ferme le flux. |

## Cycle de vie d'une session

1. **Initialisation (`init`)** :
   Au lancement, le client Nexus démarre le processus `agy` en mode streaming bidirectionnel NDJSON :
   ```bash
   agy -p "" --input-format stream-json --output-format stream-json --sandbox --add-dir <workspace> [--conversation <id>] [--model <model>] [--effort <effort>]
   ```
   Dès le démarrage, `agy` émet un événement `init` avec le `conversation_id`.

2. **Échange de messages (`user` / `step_update`)** :
   Les instructions sont envoyées sous forme de messages NDJSON structurés :
   ```json
   {"event": "user", "message": {"content": "Instruction..."}}
   ```
   Pendant le traitement, Antigravity émet des événements `step_update` contenant :
   - Le texte généré en cours (`text_delta`).
   - L'utilisation des tokens (`input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`).
   - Les appels d'outils (`tool_name`, `tool_info`).

3. **Résultat (`result`)** :
   Le tour se termine par un événement `result` avec le statut final (`SUCCESS` ou `ERROR`), le texte complet et la consommation cumulée de tokens.

4. **Persistance** :
   L'identifiant de la session courante (`conversation_id`), son workspace et sa branche Git associée sont enregistrés dans `context.workspaceState` sous la clé `nexus.antigravity.session`.
   Au rechargement de VS Code ou au prochain redémarrage de Nexus, la session précédente est reprise sans perte de contexte.

## Verrous et concurrence

- **Anti-collision** : Une seule commande de session ou d'exécution peut tourner à la fois.
- **Verrouillage workspace** : Toute modification de branche (`/switch`) vérifie que le turn Antigravity est terminé.
- **Fail-closed** : Si le workspace présente des fichiers non sauvegardés ou des conflits Git, le démarrage d'une session est bloqué.
