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
├── types.ts         # Types : CoreConfig, ConnectedNode, CoreStatusSnapshot, etc.
├── presence.ts      # NodePresenceManager : gestion des sessions, heartbeat et liveness
├── ws-connection.ts # Gestionnaire WebSocket RFC 6455 : upgrade HTTP, trames texte, ping/pong
├── nexus-core.ts    # Classe NexusCore : serveur HTTP & WebSocket, routage et messages
├── cli.ts           # Script exécutable autonome (nexus-core / npm run core)
└── index.ts         # Exports publics du module
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

## 4. Endpoints HTTP & WebSocket du serveur Core

Lorsqu'un port est configuré (`port > 0` ou `port: 0` pour un port éphémère), Nexus Core démarre un serveur HTTP intégré supportant l'upgrade WebSocket RFC 6455 :

| Méthode | Chemin | Description | Réponse |
| --- | --- | --- | --- |
| `GET` | `/` | Application Web PWA (si `publicDir` configuré) | `200 text/html` (Nuxt PWA) |
| `GET` | `/health` | Vérification de vivacité du serveur | `200 { "status": "ok", "version": "0.4.1" }` |
| `GET` | `/status` | Snapshot de statut global | `200 CoreStatusSnapshot` (uptime, nœuds, projets, tâches) |
| `GET` | `/api/nodes` | Liste des nœuds connectés | `200 ConnectedNode[]` |
| `GET` | `/api/projects` | Projets des nœuds en ligne | `200 NodeProjectSummary[]` |
| `GET` | `/api/tasks` | Liste des tâches distantes enregistrées | `200 RemoteTask[]` |
| `POST` | `/api/tasks` | Soumettre ou exécuter une tâche distante | `202 RemoteTask` (asynchrone) ou `200 TaskCompletedPayload` (si `wait: true`) |
| `GET` | `/api/tasks/:id` | Détails et statut d'une tâche | `200 RemoteTask` (ou `404`) |
| `POST` | `/api/tasks/:id/cancel` | Annuler une tâche en cours d'exécution | `200 { "taskId": "...", "cancelled": true }` |
| `GET` | `/api/approvals` | Liste des approbations en attente | `200 PendingApproval[]` |
| `POST` | `/api/approvals/:id/decide` | Soumettre une décision d'approbation | `200 PendingApproval` |
| `POST` | `/api/message` | Envoi d'un message protocole JSON | `200 AnyNexusMessage` ou `204 No Content` |
| `OPTIONS`| `*` | Requête preflight CORS | `204 No Content` (en-têtes CORS complets) |
| `GET` (Upgrade) | `/ws` | Canal bidirectionnel temps réel pour Desktop Nodes | Connexion WebSocket RFC 6455 |

> **Support CORS & PWA** : Tous les endpoints HTTP exposent les en-têtes `Access-Control-Allow-Origin: *`, autorisant l'accès direct depuis n'importe quelle application cliente ou environnement de développement Web. Si l'option `publicDir` (ou `NEXUS_PUBLIC_DIR`) est configurée, Core sert directement les fichiers statiques de l'application Nuxt PWA sur le port principal (par défaut 4040), avec support du routage SPA.

---

## 5. Routage des tâches distantes (`TaskRouter`)

Le module [`TaskRouter`](../src/core/task-router.ts) gère la distribution, le suivi et le cycle de vie des tâches adressées aux Desktop Nodes connectés :

```text
Client (HTTP / Telegram / PWA)                   Nexus Core                                   Desktop Node
            │                                         │                                             │
            ├───── POST /api/tasks (prompt, agent) ──►│ (Choix du nœud cible)                       │
            │                                         ├────────────── task:start ──────────────────►│ (Verrouille state: busy)
            │                                         │◄───────────── task:progress ────────────────┤
            │◄──── 202 Accepted { taskId } ───────────┤                                             │
            │                                         │                                             ▼
            │                                         │                                    (Exécution agent local)
            │                                         │                                             │
            │                                         │◄───────────── task:completed ───────────────┤ (Restaure state: idle)
            │                                         │                                             │
            ├───── GET /api/tasks/:id ───────────────►│                                             │
            │◄──── 200 OK { status: 'completed' } ────┤                                             │
```

### 5.1 Résolution et sélection du Desktop Node
Lorsqu'une tâche est soumise :
1. Si un `nodeId` explicite est fourni, Core vérifie que ce nœud est en ligne et disponible.
2. Si un `projectId` est spécifié, Core cible le premier nœud en ligne qui héberge ce projet.
3. À défaut, Core cible le nœud principal en ligne (`getPrimaryOnlineNode()`).
4. Si aucun nœud n'est disponible, l'appel échoue immédiatement avec l'erreur `NODE_OFFLINE` (code HTTP 503). Si le nœud est déjà occupé, l'appel échoue avec `NODE_BUSY` (code HTTP 400).

### 5.2 Annulation de tâche en vol
- Un client peut demander l'annulation d'une tâche via `POST /api/tasks/:id/cancel` ou `core.cancelTask(taskId)`.
- Si le nœud est connecté, Core lui expédie immédiatement le message `task:cancel`. Le Desktop Node interrompt alors son `AbortSignal` et annule le runner d'agent local.
- La tâche passe à l'état `cancelled` avec le code `TASK_CANCELLED`.

### 5.3 Déconnexion imprévue en cours de tâche (Fail-Closed)
Si un Desktop Node se déconnecte subitement (coupure réseau, extinction PC, crash) alors qu'une tâche est en statut `pending` ou `running` :
- La fermeture de la socket WebSocket est détectée immédiatement par Core.
- `TaskRouter.handleNodeDisconnected(nodeId)` fait échouer sur-le-champ toutes les tâches en cours sur ce nœud avec l'erreur `NODE_OFFLINE`.
- Aucune promesse ne reste suspendue indéfiniment.

---

## 6. Utilisation en ligne de commande

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

## 6. Déploiement Docker & Docker Compose

Nexus Core est prêt pour un déploiement sécurisé et autonome sur VPS ou en conteneur Docker.

### 6.1 Démarrage rapide avec Docker Compose

```bash
# 1. Copier le fichier d'exemple des variables d'environnement
cp .env.example .env

# 2. Configurer votre jeton sécurisé dans .env
# NEXUS_CORE_AUTH_TOKENS=votre-jeton-secret-aleatoire

# 3. Lancer le service en arrière-plan
docker compose up -d

# 4. Vérifier l'état et la santé du conteneur
docker compose logs -f
curl http://localhost:4040/health
```

### 6.2 Image Docker multi-stage (`Dockerfile`)

- **Image de base** : `node:24-alpine`.
- **Empreinte minimale** : ~170 Mo (runtime complet Node.js 24 + bundle `dist/core.js` autonome sans aucun `node_modules` de build).
- **Sécurité** : L'application tourne sous l'utilisateur non-root standard `node`.
- **Healthcheck intégré** : Vérification automatique de l'endpoint `/health` avec Node.js natif `fetch`.

---

## 7. Validation par les tests

Les suites de tests unitaires valident le fonctionnement de Nexus Core :
- [`src/test/unit/nexus-core.unit.ts`](../src/test/unit/nexus-core.unit.ts) :
  - Enregistrement de nœud (`node:welcome`, attribution de `sessionId`).
  - Refus strict en cas de jeton d'authentification invalide (`UNAUTHENTICATED`).
  - Renouvellement de présence par battement de cœur (`node:heartbeat` → `node:heartbeat_ack`).
  - Détection de perte de contact (`checkLiveness`) et basculement automatique hors ligne.
  - Propagation des mises à jour d'état (`node:status`).
  - Traitement direct des messages de protocole et enveloppes d'erreurs (`core:error`).
  - Fonctionnement complet du serveur HTTP (`/health`, `/status`, `/api/nodes`, `/api/projects`, `/api/message`).
  - Options du CLI (`--help`, `--version`).
- [`src/test/unit/desktop-connection.unit.ts`](../src/test/unit/desktop-connection.unit.ts) :
  - Connexion WebSocket de bout en bout entre Desktop Node et Nexus Core.
  - Heartbeats réguliers et maintien de liaison.
  - Reconnexion automatique avec backoff exponentiel.
  - Déconnexion et basculement immédiat hors ligne.
- [`src/test/unit/core-task-routing.unit.ts`](../src/test/unit/core-task-routing.unit.ts) :
  - Soumission et routage de tâches à distance (`submitTask`, `executeTask`).
  - Notification de progression en streaming (`task:progress`).
  - Annulation de tâche en cours de vol (`task:cancel` → `TASK_CANCELLED`).
  - Coupure brutale de socket et échec immédiat des tâches actives (`NODE_OFFLINE`).
  - Endpoints REST de tâches (`POST /api/tasks`, `GET /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel`).
