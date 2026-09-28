# Isolation du Runtime Agent — Nexus Runtime

Ce document décrit l'isolation de l'orchestration des agents et des contrôles de sécurité du workspace, réalisée dans le cadre de la transition vers un nœud autonome (**Desktop Node**).

Le code correspondant se situe dans [`src/runtime/`](../src/runtime/).

---

## 1. Objectifs & Motivation

Jusqu'alors, l'assemblage et la coordination des services d'agents (`CodexService`, `AntigravityService`, `ConversationalService` / Brain) étaient étroitement couplés à l'extension VS Code dans [`src/extension.ts`](../src/extension.ts).

L'objectif de cette isolation est de :
1. **Rendre l'exécution indépendante de VS Code** : Permettre d'instancier et d'exécuter un runtime complet depuis un processus en ligne de commande ou un daemon sans dépendre du module `'vscode'`.
2. **Conserver toutes les protections existantes** : Garantir que `WorkspaceGuard`, les branches protégées, les vérifications d'état Git, les approbations sensibles (`command`, `fileChange`, `inspection`) et les timeouts de tours sont appliqués de façon identique.
3. **Préparer le Desktop Daemon et le protocole distant** : Offrir une interface unifiée (`NexusRuntime`) consommable directement par le futur daemon desktop (connecté à Nexus Core via le protocole défini dans [`docs/nexus-protocol.md`](./nexus-protocol.md)).
4. **Simplifier l'extension VS Code** : Réduire `src/extension.ts` à un adaptateur léger reliant l'environnement VS Code et Telegram au `NexusRuntime`.

---

## 2. Architecture du Runtime Isolé (`src/runtime/`)

```text
┌──────────────────────────────────────────────────────────────┐
│                    Consommateurs du Runtime                  │
│                                                              │
│   Extension VS Code (existant)       Desktop Daemon (futur)  │
│         src/extension.ts               src/desktop/node.ts   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                         NexusRuntime                         │
│                  (src/runtime/nexus-runtime.ts)               │
│                                                              │
│  - executeTask(backend, prompt, options)                     │
│  - executeBrain(message, signal, options)                    │
│  - handleSessionAction(backend, action)                      │
│  - switchBranch(name) / listBranches() / handleBranchAction  │
│  - listModels(backend) / selectModel(backend, selection)     │
│  - getStatus() / cancelCurrentWork() / stop()                │
└──────┬───────────────────────┬───────────────────────┬───────┘
       │                       │                       │
       ▼                       ▼                       ▼
┌──────────────┐       ┌───────────────┐       ┌───────────────┐
│ CodexService │       │  Antigravity  │       │ Conversational│
│              │       │    Service    │       │    Service    │
│              │       │               │       │ (Nexus Brain) │
└──────┬───────┘       └───────┬───────┘       └───────┬───────┘
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               │
                               ▼
               ┌───────────────────────────────┐
               │        WorkspaceGuard         │
               │  (src/workspace/guard.ts)     │
               │                               │
               │  - Validation dépôt Git       │
               │  - Branches protégées         │
               │  - Préflight opérations       │
               └───────────────────────────────┘
```

### 2.1 Composants clés

| Fichier | Rôle |
| --- | --- |
| [`src/runtime/types.ts`](../src/runtime/types.ts) | Types du runtime : options (`NexusRuntimeOptions`), résultats de tâches (`TaskExecutionResult`), requêtes et gestionnaires d'approbation unifiés (`RuntimeApprovalRequest`, `RuntimeApprovalHandler`), interface de stockage (`KeyValueStorage`). |
| [`src/runtime/nexus-runtime.ts`](../src/runtime/nexus-runtime.ts) | Classe centrale orchestrant les backends Codex, Antigravity et Brain, la sélection des modèles, le cycle de vie des sessions et l'annulation. |
| [`src/runtime/workspace.ts`](../src/runtime/workspace.ts) | Fabrique `createStandaloneWorkspaceGuard` pour instancier un `WorkspaceGuard` configuré pour un chemin local sans exiger de contexte VS Code. |
| [`src/runtime/storage.ts`](../src/runtime/storage.ts) | `MemoryStorage` : Implémentation en mémoire de `KeyValueStorage` pour la persistance des sessions et préférences hors VS Code. |
| [`src/runtime/index.ts`](../src/runtime/index.ts) | Point d'entrée exportant l'ensemble de la couche runtime. |

---

## 3. Maintien intégral des protections

L'isolation conserve rigoureusement toutes les frontières de sécurité établies :

### 3.1 Protection du Workspace et Git (`WorkspaceGuard`)
- Les branches protégées (`main`, `master` par défaut ou liste configurée) bloquent toute exécution de prompt ou action modifiante.
- Les états instables (`MERGE_HEAD`, `rebase-apply`, `rebase-merge`, `CHERRY_PICK_HEAD`, `index.lock`, conflits d'index) déclenchent un refus immédiat et explicite avant toute intervention d'agent.
- Les dépôts non autorisés ou mal configurés sont rejetés.

### 3.2 Approbations délimitées (Scoped Approvals)
- Toutes les actions sensibles nécessitant l'intervention de l'utilisateur (`command`, `fileChange` Codex/Antigravity et demandes de consentement d'inspection Brain `kind: 'inspection'`) passent par `RuntimeApprovalHandler`.
- Si aucun gestionnaire d'approbation n'est configuré (environnement headless sans interaction), le runtime applique la règle du **refus par défaut** (`'decline'` / `false`).
- Les demandes d'inspection du Brain indiquent le nom du projet, la branche et le motif, et expirent avec un délai prévisible.

### 3.3 Contrôle des tours et interruptions
- `cancelCurrentWork()` propage l'interruption à l'ensemble des runners actifs (`codexService.cancelCurrentWork()` et `antigravityService.cancelCurrentWork()`).
- Le gestionnaire de timeout de tour (`TurnTimeoutHandler`) permet d'étendre ou d'interrompre proprement les tours longs.

---

## 4. Intégration dans VS Code

Dans [`src/extension.ts`](../src/extension.ts), l'initialisation a été simplifiée :

```typescript
nexusRuntime = new NexusRuntime({
  workspaceGuard,
  targetPath: () => workspaceGuard.targetPath(),
  requestApproval: async (request, signal) => telegramService.requestApproval(request, signal),
  requestTurnTimeoutContinuation: async (request, signal) => telegramService.requestTurnTimeoutContinuation(request, signal),
  codexPersistence: new WorkspaceSessionPersistence(context.workspaceState),
  codexModelPreferences: new WorkspaceModelPreferences(context.workspaceState),
  antigravityPersistence: new WorkspaceAntigravitySessionPersistence(context.workspaceState),
  antigravityModelPreferences: new WorkspaceAntigravityModelPreferences(context.workspaceState),
  antigravityConfig: {
    executablePath: config.get<string>('antigravity.executablePath') || undefined,
    sandbox: config.get<boolean>('antigravity.sandbox', true),
    dangerouslySkipPermissions: config.get<boolean>('antigravity.dangerouslySkipPermissions', false),
  },
  defaultBackend: activeBackend,
});
```

Tous les flux de prompts, changements de sessions, choix de modèles et gestion des branches délèguent directement à l'instance `nexusRuntime`.

---

## 5. Validation par les tests

La suite [`src/test/unit/agent-runtime.unit.ts`](../src/test/unit/agent-runtime.unit.ts) valide :
- L'instanciation autonome avec `createStandaloneWorkspaceGuard` et `MemoryStorage`.
- La délégation des tâches au Brain (`executeBrain`, `executeTask('brain', ...)`).
- Le pont de consentement d'inspection du Brain vers `requestApproval` (accord et refus explicite).
- La priorité de résolution du chemin de travail (`explicit > supplier > guard`).
- La capture de l'état sans fenêtre VS Code (`getStatus()`).
- La gestion des branches Git en mode isolé (`handleBranchAction`).
- L'annulation synchronisée du travail en cours (`cancelCurrentWork()`).
