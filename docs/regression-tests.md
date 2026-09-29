# Tests de régression Nexus

Depuis le terminal du projet Nexus :

```sh
npm run test:unit
npm run compile
npm --prefix web run test:unit
npm run web:build
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


## Fiabilité, voix et interface

| Scénario | Vérification |
| --- | --- |
| Logs | Filtrage des niveaux, exclusion des payloads, secrets masqués, erreurs structurées, rotation et panne de destination (`logger.unit.ts`, `log-persistence.unit.ts`). |
| Diagnostics | Configuration distinguée de la disponibilité, contrôle d’accès Telegram (`diagnostics.unit.ts`). |
| Piper | WAV/Opus invalides, erreur du worker, timeout, annulation pendant la conversion, vitesse invalide et repli texte (`speech-acknowledgement.unit.ts`, `telegram-acknowledgement.unit.ts`). |
| Telegram | Indicateur d’activité borné, sans requêtes parallèles ; arrêt au changement de génération et à l’annulation (`telegram-activity.unit.ts`). |
| Client web | Remplacement d’une lecture, timeout, voix/vitesse, nettoyage Markdown et états d’activité (`web/test/*.test.mjs`). |

`npm test` lance aussi les tests d’intégration de l’extension : activation,
présence des commandes historiques et exécution de Diagnostics sans workspace.
Le lanceur crée un profil temporaire neuf pour ne pas réutiliser vos identifiants
ou votre appairage Telegram. Sur Linux sans écran, utiliser `xvfb-run -a npm test`
si Xvfb est installé. Le lanceur standard peut télécharger VS Code au premier essai.

Validation de cette itération : 527 tests backend, 12 tests web et 2 tests
VS Code réussis ; compilation/lint TypeScript et génération Nuxt réussies.
L’essai VS Code a utilisé la version locale 1.139.1 avec un profil isolé.

Le contrôle Chrome headless, sur une API simulée, a vérifié le montage de l’app,
les préférences vocales, la géométrie de l’en-tête en 390 × 844 et le parcours
READY → THINKING → READY → CODING → ERROR → OFFLINE, sans exception JavaScript.
Les états de connexion et d’avancement ont été vérifiés sans contacter les agents.
L’essai réel Piper et les mesures audio sont consignés dans
[l’audit](reliability-audit.md). L’écoute sur un téléphone Android réel et
l’appréciation du naturel de la voix restent des validations sur l’appareil cible.


## Réponse Android et fournisseurs cloud — septembre 2026

Validation de cette suite : **548 tests backend, 18 tests web, 2 tests d’intégration
VS Code**, compilation/lint et génération Nuxt réussis. L’APK Android est reconstruite
avec le plugin TTS natif ; elle est produite à la racine dans `nexus-debug.apk`.

- `cloud-brain.unit.ts` : contrats des quatre API, JSON invalide, limites et refus,
  classification des erreurs HTTP, délais, authentification sans clé dans l’URL.
- `brain-routing.unit.ts` : ordre de repli, fournisseurs sans clé ignorés, sélection
  locale isolée, annulation, délai global, changement de modèle pendant un appel,
  absence de secrets et de conversations dans les logs.
- `agent-runtime.unit.ts` : sélection cloud, statut et réponse via `executeTask`.
- `web/test/native-speech-playback.test.mjs` : moteur natif simulé, annulation,
  segments, délais, erreurs, voix et préférence de lecture selon l’origine vocale.

Le test de l’application générée utilise Chromium et un pont Capacitor Android
simulé, sans micro, service cloud ni téléphone :

```sh
npm run web:build
node scripts/test-android-voice.cjs
```

Par défaut le script utilise `/usr/bin/google-chrome` ; `CHROME_BIN` permet de
choisir Chromium. Sur un environnement de test isolé qui exige la désactivation
du sandbox Chrome, utiliser `CHROME_NO_SANDBOX=1`.

Ce parcours vérifie la dictée envoyée manuellement et automatiquement, la lecture
native de la réponse finale malgré la lecture des messages écrits désactivée,
le nettoyage du Markdown, la voix/vitesse, l’arrêt au micro, la remise à zéro d’un
brouillon dicté effacé et le silence lorsque la voix est désactivée.
L’ancienne vérification Chrome mobile des états et préférences reste réussie.

Les tests cloud utilisent des réponses HTTP simulées. L’accès réel aux comptes
sera vérifiable après saisie des clés. Le test Android simulé et la compilation
ne vérifient pas le son physique : installer l’APK puis essayer « Écouter un
exemple » et une demande dictée sur le téléphone cible.

## Dashboard, voix française et transitions — 29 septembre 2026

559 tests backend, 23 tests web et 2 tests VS Code réussis. Les tests `provider-usage.unit.ts` et
`dashboard.unit.ts` vérifient les relevés, les quotas épuisés, les horodatages,
le cache OpenRouter, l’absence de secrets et le transport réel Core/Desktop
avec authentification, refus des réponses d’un autre nœud et délais bornés.

`web/test/speech-voice.test.mjs` vérifie la priorité `fr-FR` et le regroupement des
phrases. Le contrôleur natif vérifie aussi le repli d’une voix en ligne vers une
voix locale française. `usage-dashboard.test.mjs` distingue quota nul, absent
et expiré. Le script `test-android-voice.cjs` couvre désormais aussi le dashboard,
les onglets clavier, le viewport mobile et les animations réduites. La variable
optionnelle `NEXUS_SCREENSHOT` permet d’enregistrer une capture avec des données
simulées. Voir [le périmètre des métriques](usage-dashboard.md).
