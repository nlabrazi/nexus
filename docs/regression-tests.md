# Tests de régression Nexus

Depuis le terminal du projet Nexus :

```sh
npm run test:unit
npm run compile
```

Attendu : tous les tests passent, puis compilation et lint sans erreur. Aucun bot
réel ni compte Codex n’est nécessaire pour ces tests. Les transports Telegram et
Codex sont simulés ; les contrôles Git utilisent aussi des dépôts temporaires réels.

## Scénarios couverts

| Scénario | Résultat vérifié | Tests |
| --- | --- | --- |
| Redémarrage Telegram | Offset repris, anciennes commandes/anciens boutons ignorés, aucune réponse de l’ancien polling exécutée après arrêt | `regressions.unit.ts`, `telegram-service.unit.ts` |
| Approbation expirée | Refus après expiration, clic tardif inopérant, nettoyage des boutons | `approvals.unit.ts` |
| Codex absent | Erreur explicite dans Telegram, verrous libérés, nouvelle tentative possible | `regressions.unit.ts`, `codex-errors.unit.ts` |
| Antigravity absent | Erreur explicite avec code `not_installed`, instructions d'installation claires | `antigravity-errors.unit.ts`, `antigravity-client.unit.ts` |
| Workspace absent | Refus avant lancement du processus, nouvelle tentative possible | `regressions.unit.ts`, `workspace-guard.unit.ts` |
| Double session/double prompt | Une seule sélection ou exécution, blocage maintenu si Telegram redémarre pendant un turn | `regressions.unit.ts`, `codex-sessions.unit.ts`, `telegram-sessions.unit.ts` |
| Crash du processus | Erreur immédiate, approbations invalidées, ancienne session reprise au prochain prompt, événements tardifs ignorés | `regressions.unit.ts`, `codex-client.unit.ts`, `codex-errors.unit.ts`, `antigravity-client.unit.ts` |
| Arrêt manuel | Annulation pendant démarrage, validation ou approbation, arrêt de Codex et Antigravity | `telegram-stop.unit.ts`, `telegram-antigravity.unit.ts` |
| Persistance | Restauration inactive, reprise de la session, branche vérifiée, erreurs de stockage explicites | `codex-persistence.unit.ts`, `antigravity-persistence.unit.ts` |
| Télémétrie et tokens | Parsing NDJSON Antigravity (défense en profondeur contre compteurs négatifs et nan), calcul context window | `antigravity-telemetry.unit.ts` |
| Modèles et catalogue | Récupération catalogue `agy models`, pagination, sélection effort de raisonnement, persistance workspace | `antigravity-models.unit.ts`, `telegram-models.unit.ts` |
| Multi-Backend Telegram | Bascule `/backend [codex\|antigravity]`, routage `/new`, `/resume`, `/model`, prompts `/antigravity`, `/agy`, `/gemini` | `telegram-antigravity.unit.ts` |

Tous les fichiers cités se trouvent dans `src/test/unit/`.

Le lot de régression ajoute un filtrage explicite des updates dont l’identifiant
est inférieur à l’offset courant. Le test échouait auparavant : une réponse de
polling ancienne pouvait rejouer une commande déjà traitée et faire reculer l’offset.
Les doublons d’un même lot sont maintenant ignorés également.

L’offset est enregistré avant de lancer la commande. Cela évite de rejouer une
action après redémarrage, mais une fermeture entre l’enregistrement et son exécution
peut perdre la demande. Nexus n’offre pas une garantie d’exécution exactement une
fois. Les verrous sont locaux à une instance CodexService : deux instances VS Code
simultanées restent hors de cette garantie.

## Vérification Telegram facultative

Les cas d’erreur et de concurrence ci-dessus se testent directement avec
`npm run test:unit`, sans désinstaller Codex ni supprimer votre workspace.
Pour un contrôle réel du parcours normal, fermer l’ancienne fenêtre de test puis
lancer depuis le terminal Nexus :

```sh
npm run dev:prepare
code --new-window --extensionDevelopmentPath="$PWD" --disable-workspace-trust "$PWD/.nexus-dev/project"
```

1. Envoyer `/codex Exécute sleep 30 puis réponds Terminé.`
2. Pendant le turn, envoyer `/new` : refus, sans création d’une seconde session.
3. Envoyer `/stop`, puis `/status` : aucune activité, session conservée.
4. Envoyer `/codex Réponds uniquement OK.` : réponse reçue et même identifiant.

Le dossier de test, l’appairage et l’authentification sont décrits dans
[le guide de développement](development.md). Les tests automatisés ne remplacent
pas la vérification du client Telegram et du binaire Codex réellement installés.
