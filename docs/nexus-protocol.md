# Protocole Nexus — Messages minimaux du premier parcours distant

Ce document spécifie le protocole de communication minimal (`v: 1`) reliant le nœud Desktop (**Desktop Node**), le serveur central (**Nexus Core**) et les clients distants (**Telegram / PWA**).

Le code correspondant se situe dans [`src/protocol/`](../src/protocol/).

---

## 1. Objectifs & Périmètre

Le protocole Nexus définit les contrats d’échanges nécessaires pour :
1. **Enregistrer un Desktop Node** auprès de Nexus Core avec authentification et suivi de présence (heartbeat).
2. **Déclencher et suivre une tâche distante** (`codex`, `antigravity` ou `brain`) avec retour de progression et résultat final.
3. **Relayer les approbations délimitées (scoped approvals)** pour les actions sensibles (`command`, `fileChange`, `consent`) avec expiration et refus par défaut.
4. **Gérer les annulations et déconnexions** de manière prévisible et sécurisée.

Ce protocole est indépendant du transport sous-jacent (WebSocket, IPC ou HTTP).

---

## 2. Enveloppe standard (`NexusMessageEnvelope`)

Chaque message respecte une enveloppe JSON stricte :

```typescript
interface NexusMessageEnvelope<TType extends NexusMessageType, TPayload> {
  readonly v: 1;                 // Version de protocole (actuellement 1)
  readonly id: string;            // Identifiant unique de message (UUID)
  readonly type: TType;          // Type discriminant du message
  readonly timestamp: number;     // Timestamp Unix en millisecondes
  readonly traceId?: string;      // Identifiant de corrélation optionnel
  readonly payload: TPayload;     // Données typées du message
}
```

Toute violation de version (`v !== 1`), identifiant manquant, timestamp non positif ou type inconnu provoque un rejet immédiat avec `NexusProtocolError` (`INVALID_MESSAGE` ou `PROTOCOL_VERSION_MISMATCH`).

---

## 3. Types de messages & Cycle de vie

### 3.1 Présence et enregistrement du nœud Desktop

```text
Desktop Node                                     Nexus Core
     │                                                │
     ├───────────── node:hello (auth + projets) ─────►│
     │◄──────────── node:welcome (sessionId) ─────────┤
     │                                                │
     ├───────────── node:heartbeat (état) ───────────►│
     │◄──────────── node:heartbeat_ack ───────────────┤
     │                                                │
     ├───────────── node:status (changement d'état) ─►│
```

* **`node:hello`** : Présentation du nœud (identifiant, capacités, jeton d’authentification, liste des projets locaux disponibles).
* **`node:welcome`** : Confirmation de connexion par Core, attribution d’une session et intervalle de battement de cœur (`heartbeatIntervalMs`).
* **`node:heartbeat`** / **`node:heartbeat_ack`** : Maintien du lien de présence et détection des nœuds hors ligne (`idle`, `busy`, `draining`).
* **`node:status`** : Notification d’un changement d’état du nœud (ex. tâche en cours, projet actif).

### 3.2 Exécution de tâche distante

```text
Client (Telegram / PWA)          Nexus Core               Desktop Node
     │                               │                          │
     ├────── Demande utilisateur ───►│                          │
     │                               ├────── task:start ───────►│
     │                               │                          ├─ Démarrage agent
     │                               │◄───── task:progress ─────┤
     │◄───── Mise à jour UI ─────────┤                          │
     │                               │◄───── task:completed ────┤
     │◄───── Réponse finale ─────────┤                          │
```

* **`task:start`** : Demande d’exécution envoyée au nœud Desktop (`taskId`, `backend`, `prompt`, `projectId`, `sessionId`).
* **`task:cancel`** : Demande d’interruption immédiate de la tâche en cours.
* **`task:progress`** : Événement intermédiaire émis par le Desktop (`starting`, `inspecting`, `executing`, `synthesizing`).
* **`task:completed`** : Résultat final contenant le texte produit, le résumé de fichiers modifiés (`fileSummary`, `filesChanged`) et les métriques d'usage.
* **`task:failed`** : Échec structuré avec code d'erreur standardisé (`NexusErrorCode`).

### 3.3 Demandes d'approbation délimitées (Scoped Approvals)

```text
Desktop Node                      Nexus Core               Client (Telegram / PWA)
     │                                 │                              │
     ├────── approval:request ────────►│                              │
     │       (kind, details, timeout)  ├────── Notification UI ──────►│
     │                                 │                              │
     │                                 │◄───── Décision utilisateur ──┤
     │◄───── approval:decision ────────┤       (accept / decline)     │
     │       (accept / decline)        │                              │
```

* **`approval:request`** : Émis par le Desktop Node dès qu'un outil guard-rail (`run_command`, `write_to_file`, etc.) ou un consentement d'inspection est requis. Contient un délai d'expiration strict (`expiresAt`).
* **`approval:decision`** : Décision transmise par l'utilisateur (`accept` ou `decline`).
* **`approval:cancelled`** : Émis si la demande a expiré ou si la tâche parente a été annulée avant décision.
* **Sécurité par défaut** : Si `expiresAt` est dépassé sans réponse, ou en cas de déconnexion réseau, la décision est **systématiquement traitée comme un refus (`decline`)**.

### 3.4 Erreurs Core

* **`core:error`** : Notification d'erreur émise par Core (ex. nœud hors ligne, non authentifié, format invalide).

---

## 4. Codes d'erreurs standardisés (`NexusErrorCode`)

| Code | Signification |
| --- | --- |
| `UNAUTHENTICATED` | Jeton d'authentification absent ou invalide. |
| `UNAUTHORIZED` | Droits insuffisants pour l'action demandée. |
| `NODE_OFFLINE` | Aucun nœud desktop connecté ou le nœud ciblé est indisponible. |
| `NODE_BUSY` | Le nœud desktop traite déjà une autre tâche active. |
| `PROJECT_NOT_FOUND` | Le projet demandé n'existe pas sur le nœud. |
| `WORKSPACE_GUARD_REJECTED` | Rejet par les protections locales (branche protégée, modifications non enregistrées, etc.). |
| `TASK_NOT_FOUND` | Identifiant de tâche introuvable. |
| `TASK_ALREADY_RUNNING` | Une tâche est déjà en cours d'exécution. |
| `TASK_CANCELLED` | La tâche a été interrompue à la demande de l'utilisateur ou par timeout. |
| `TASK_TIMEOUT` | La durée maximale de la tâche a été dépassée. |
| `TASK_EXECUTION_FAILED` | Erreur lors de l'exécution de l'agent. |
| `APPROVAL_TIMEOUT` | Demande d'autorisation expirée sans réponse (refus implicite). |
| `APPROVAL_NOT_FOUND` | Demande d'autorisation introuvable ou déjà consommée. |
| `INVALID_MESSAGE` | Structure JSON ou données du message non conformes. |
| `PROTOCOL_VERSION_MISMATCH` | Incompatibilité de version de protocole. |
| `INTERNAL_ERROR` | Erreur inattendue interne. |

---

## 5. Garanties et frontières de sécurité

1. **Aucune confiance aveugle dans le modèle** : Les autorisations proviennent toujours d'une interaction explicite de l'utilisateur (ou d'une politique déclarée par l'application), jamais de la réponse de l'agent.
2. **Refus par défaut** : Toute interruption, déconnexion ou expiration équivaut à un refus (`decline`).
3. **Protection des workspaces** : Le protocole transporte des identifiants et des chemins relatifs ou normalisés ; la validation effective des chemins et des branches Git (`WorkspaceGuard`) reste strictement exécutée côté Desktop Node avant tout accès.
