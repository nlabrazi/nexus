# Desktop Node — Point d'entrée autonome

Ce document décrit le **Desktop Node** de Nexus ([`src/desktop/`](../src/desktop/)), qui permet d'exécuter et d'orchestrer les agents (`Codex`, `Gemini Antigravity`, `Nexus Brain`) depuis le terminal avec un ou plusieurs projets explicitement configurés, sans dépendre d'une instance VS Code ouverte.

---

## 1. Objectifs & Fonctionnalités

Le Desktop Node constitue la brique locale de l'architecture découplée de Nexus :
1. **Indépendance vis-à-vis de VS Code** : Il s'exécute directement en ligne de commande via l'exécutable `nexus-desktop` (ou `npm run desktop`).
2. **Configuration explicite des projets** : Chaque projet local est déclaré avec son chemin absolu ou relatif, son nom et ses branches protégées.
3. **Contrôle d'intégrité et Git** : Le node utilise [`createStandaloneWorkspaceGuard`](../src/runtime/workspace.ts) pour valider le répertoire, identifier la branche courante et interdire toute exécution sur une branche protégée ou dans un état Git instable.
4. **Conformité au Protocole Nexus v1** : Il génère les enveloppes et payloads de protocole ([`src/protocol/`](../src/protocol/)) nécessaires à l'enregistrement (`node:hello`), au heartbeat (`node:heartbeat`) et aux statuts (`node:status`).
5. **Gestion sécurisée des approbations** : En mode interactif, les actions sensibles (`command`, `fileChange`, inspection Brain) sont soumises à confirmation sur le terminal. En mode non-interactif, la politique de **refus par défaut (fail closed)** s'applique.

---

## 2. Architecture des composants (`src/desktop/`)

```text
src/desktop/
├── types.ts     # Interfaces : DesktopNodeConfig, DesktopProjectConfig, DesktopNodeStatus, etc.
├── config.ts    # Résolution et validation : CLI flags, variables d'environnement, fichier JSON
├── node.ts      # Classe DesktopNode : cycle de vie (start, stop), gestion des projets, exécution
├── cli.ts       # Script exécutable avec parseArgs, bannières et gestion des signaux (SIGINT/SIGTERM)
└── index.ts     # Exports publics du module
```

---

## 3. Utilisation en ligne de commande

### 3.1 Démarrer le daemon (`start`)

Démarre le Desktop Node en avant-plan et affiche la bannière d'état :

```bash
# Via l'exécutable direct
nexus-desktop start --project /chemin/vers/mon-projet --backend codex

# Ou via le script npm
npm run desktop -- start --project /chemin/vers/mon-projet
```

Sortie attendue :
```text
================================================================
  🌟 NEXUS DESKTOP NODE v0.4.1
================================================================
  • Nœud ID        : a1b2c3d4-e5f6-7890-abcd-ef1234567890
  • Nom            : STATION-DEV
  • État           : idle
  • Projet actif   : mon-projet
  • Répertoire     : /home/user/code/mon-projet
  • Branche Git    : feature/ma-branche
  • Agent défaut   : codex
================================================================
Desktop Node prêt. En attente de tâches (Ctrl+C pour quitter)...
```

Une interruption `Ctrl+C` (`SIGINT` ou `SIGTERM`) déclenche un arrêt ordonné (`draining`), annule les opérations en cours et libère les ressources.

---

### 3.2 Vérifier l'état (`status`)

Valide le projet, inspecte les backends et affiche l'état avant de quitter (code de retour `0` si sain) :

```bash
nexus-desktop status --project /chemin/vers/mon-projet
```

Sortie :
```text
📊 ÉTAT DU NEXUS DESKTOP NODE
• Nœud ID        : a1b2c3d4-e5f6-7890-abcd-ef1234567890
• Nom du nœud    : STATION-DEV
• État           : idle
• Projet actif   : mon-projet (/home/user/code/mon-projet)
• Branche Git    : staging
• Agent actif    : codex
• Projets totaux : 1
```

---

### 3.3 Exécuter un prompt ponctuel (`exec`)

Permet de lancer une instruction technique ou une discussion Brain directement depuis le terminal sans interface graphique :

```bash
# Exécution avec Codex
nexus-desktop exec --project ./repo --backend codex "Créer un script d'audit des dépendances"

# Consultation du Brain
nexus-desktop exec --project ./repo --backend brain "Explique-moi la structure du projet"
```

---

## 4. Options et Configuration

### 4.1 Arguments de ligne de commande

| Option | Raccourci | Description | Défaut |
| --- | --- | --- | --- |
| `--project <path>` | `-p` | Chemin vers le répertoire du projet (obligatoire ou via env) | - |
| `--name <name>` | `-n` | Nom lisible du projet ou du nœud | Nom du dossier |
| `--backend <agent>` | `-b` | Backend par défaut (`codex`, `antigravity`, `brain`) | `codex` |
| `--config <file>` | `-c` | Chemin vers un fichier de configuration JSON | - |
| `--node-id <id>` | - | Identifiant unique du nœud | UUID généré |
| `--token <token>` | `-t` | Jeton d'authentification pour Nexus Core | `""` |
| `--help` | `-h` | Affiche l'aide complète | - |
| `--version` | `-v` | Affiche la version | - |

### 4.2 Variables d'environnement

| Variable | Description |
| --- | --- |
| `NEXUS_PROJECT_PATH` | Chemin du projet par défaut |
| `NEXUS_PROJECT_NAME` | Nom du projet par défaut |
| `NEXUS_DEFAULT_BACKEND` | Backend agent par défaut (`codex`, `antigravity`, `brain`) |
| `NEXUS_NODE_ID` | Identifiant fixe du nœud |
| `NEXUS_NODE_NAME` | Nom d'hôte du nœud |
| `NEXUS_AUTH_TOKEN` | Jeton d'authentification du nœud |
| `NEXUS_CONFIG` | Chemin vers un fichier de configuration JSON |

### 4.3 Fichier de configuration JSON (`nexus-desktop.json`)

```json
{
  "nodeId": "mon-desktop-principal",
  "nodeName": "Workstation Linux",
  "defaultBackend": "codex",
  "projects": [
    {
      "id": "nexus",
      "name": "Nexus Core Repository",
      "path": "/home/user/code/nexus",
      "protectedBranches": ["main", "master", "release"]
    }
  ]
}
```

---

## 5. Sécurité et Modèle d'approbation

- **Fail-closed par défaut** : Si le Desktop Node fonctionne en arrière-plan sans TTY interactif (`process.stdin.isTTY === false`), toute demande d'approbation (`command`, `fileChange`, ou inspection Brain) est immédiatement refusée (`decline`).
- **Confirmation interactive en terminal** : Lorsqu'un terminal interactif est attaché, les requêtes d'approbation s'affichent sur `stderr` avec les détails de l'action envisagée et attendent une confirmation explicite (`y` / `yes` / `o` / `oui`).
- **Préflight Git strict** : Les branches protégées (`main`, `master` par défaut) et les répertoires en conflit d'index bloquent toute tâche avant son exécution.

---

## 6. Validation par les tests

La suite [`src/test/unit/desktop-node.unit.ts`](../src/test/unit/desktop-node.unit.ts) couvre :
- La résolution et la déduplication de la configuration (CLI, env vars, fichier JSON).
- Le rejet des projets inexistants ou des backends inconnus.
- Le cycle de vie complet du nœud (`start`, `getStatus`, `stop`).
- La conformité des messages de protocole v1 (`node:hello`, `node:heartbeat`, `node:status`).
- La gestion multi-projets et le basculement de projet actif (`setActiveProject`).
- L'exclusion des tâches concurrentes avec transition d'état (`idle` -> `busy` -> `idle`).
- Les commandes CLI (`start`, `status`, `exec`, `--help`, `--version`).
