# Nexus Core — Service central et suivi de présence

Ce document spécifie le service central **Nexus Core** ([`src/core/`](../src/core/)), conçu pour fonctionner sur un serveur distant (VPS) ou en local afin de coordonner les Desktop Nodes, suivre leur présence et servir de passerelle pour les clients distants (Telegram, PWA).

---

## 1. Rôle et Responsabilités

Nexus Core constitue le point de ralliement de l'architecture distribuée Nexus :
1. **Authentification des Desktop Nodes** : Validation du jeton de sécurité (`authToken`) lors de la poignée de main initiale (`node:hello`).
2. **Suivi de présence & Heartbeat** : Enregistrement des nœuds actifs, battement de cœur régulier (`node:heartbeat` / `node:heartbeat_ack`) et détection automatique des nœuds hors ligne (`node:offline`).
3. **Registre dynamique des projets** : Agrégation des projets déclarés par les Desktop Nodes actuellement en ligne (`listProjects()`).
4. **Passerelle de messages unifiée** : Traitement des messages du protocole Nexus v1 ([`src/protocol/`](../src/protocol/)) avec validation et retour d'erreurs normées (`core:error`).
5. **Serveur HTTP / API de santé** : Endpoints REST pour le monitoring, le diagnostic et l'échange de messages.

---

## 2. Architecture des composants (`src/core/`)

```text
src/core/
├── types.ts       # Types : CoreConfig, ConnectedNode, CoreStatusSnapshot, etc.
├── presence.ts    # NodePresenceManager : gestion des sessions, heartbeat et liveness
├── nexus-core.ts  # Classe NexusCore : serveur HTTP, routage et traitement des messages
├── cli.ts         # Script exécutable autonome (nexus-core / npm run core)
└── index.ts       # Exports publics du module
```

---

## 3. Cycle de vie de la présence

```text
Desktop Node                                     Nexus Core
     │                                                │
     ├───────────── node:hello (auth + projets) ─────►│ (Vérification authToken)
     │◄──────────── node:welcome (sessionId) ─────────┤ (Session attribuée)
     │                                                │
     ├───────────── node:heartbeat (état) ───────────►│ (Renouvellement timer)
     │◄──────────── node:heartbeat_ack ───────────────┤
     │                                                │
     ├───────────── node:status (changement état) ───►│ (Mise à jour état / projet)
     │                                                │
     ... (Absence de heartbeat > 45s) ............... │
     │                                                ▼
     │                                           Nœud marqué 'offline'
```

### 3.1 Détection des nœuds hors ligne
- Intervalle standard de heartbeat : **15 secondes** (configurable via `heartbeatIntervalMs`).
- Délai d'expiration de présence : **45 secondes** (configurable via `heartbeatTimeoutMs`).
- La méthode `checkLiveness()` vérifie régulièrement la fraîcheur du dernier contact. Dès qu'un nœud dépasse le délai de grâce, il est basculé à `online: false` et l'événement `node:offline` est émis. Ses projets sont alors immédiatement masqués du registre des projets disponibles.

---

## 4. Endpoints HTTP du serveur Core

Lorsqu'un port est configuré (`port > 0` ou `port: 0` pour un port éphémère), Nexus Core démarre un serveur HTTP intégré :

| Méthode | Chemin | Description | Réponse |
| --- | --- | --- | --- |
| `GET` | `/health` | Vérification de vivacité du serveur | `200 { "status": "ok", "version": "0.4.1" }` |
| `GET` | `/status` | Snapshot de statut global | `200 CoreStatusSnapshot` (uptime, nœuds, projets) |
| `GET` | `/api/nodes` | Liste des nœuds connectés | `200 ConnectedNode[]` |
| `GET` | `/api/projects` | Projets des nœuds en ligne | `200 NodeProjectSummary[]` |
| `POST` | `/api/message` | Envoi d'un message protocole JSON | `200 AnyNexusMessage` ou `204 No Content` |

---

## 5. Utilisation en ligne de commande

### 5.1 Démarrer le serveur Core

```bash
# Démarrage avec port et jeton explicites
nexus-core --port 4040 --token mon-jeton-secret

# Ou via le script npm
npm run core -- --port 4040 --token mon-jeton-secret
```

Bannière affichée :
```text
================================================================
  🌐 NEXUS CORE SERVER v0.4.1
================================================================
  • URL HTTP       : http://127.0.0.1:4040
  • Jetons admis   : 1 configuré(s)
  • Heartbeat      : 15s (délai de grâce 45s)
================================================================
Nexus Core actif. En attente de connexions (Ctrl+C pour quitter)...
```

### 5.2 Variables d'environnement

| Variable | Description | Défaut |
| --- | --- | --- |
| `NEXUS_CORE_PORT` | Port d'écoute HTTP | `4040` |
| `NEXUS_CORE_HOST` | Adresse d'écoute IP | `127.0.0.1` |
| `NEXUS_CORE_AUTH_TOKENS` | Liste de jetons admis (séparés par des virgules) | Jeton temporaire généré |

---

## 6. Validation par les tests

La suite [`src/test/unit/nexus-core.unit.ts`](../src/test/unit/nexus-core.unit.ts) valide :
- L'enregistrement d'un nœud avec jeton valide (`node:welcome`, attribution de `sessionId`).
- Le refus strict en cas de jeton d'authentification invalide (`UNAUTHENTICATED`).
- Le renouvellement de présence par battement de cœur (`node:heartbeat` → `node:heartbeat_ack`).
- La détection de perte de contact (`checkLiveness`) et le basculement automatique en mode hors ligne.
- La propagation des mises à jour d'état (`node:status`).
- Le traitement direct des messages de protocole et la génération d'enveloppes d'erreurs (`core:error`).
- Le fonctionnement complet du serveur HTTP (`/health`, `/status`, `/api/nodes`, `/api/projects`, `/api/message`).
- Les options du CLI (`--help`, `--version`).
