# Configuration et installation de Gemini Antigravity

Nexus supporte nativement **Gemini Antigravity** (`agy`) comme moteur d'agent de programmation en complément d'OpenAI Codex.

## Prérequis

- Le binaire `agy` (Google Antigravity CLI v1.2+).
- Authentification configurée pour Antigravity (compte Google Cloud / Gemini API).
- VS Code avec l'extension Nexus installée et activée.

Pour vérifier la présence d'Antigravity sur votre machine :
```bash
agy --version
agy models
```

## Options de configuration VS Code

Nexus expose les paramètres suivants dans les réglages de VS Code (`settings.json`) :

| Paramètre | Type | Valeur par défaut | Description |
| --- | --- | --- | --- |
| `nexus.defaultBackend` | `string` | `"codex"` | Backend actif par défaut (`"codex"` ou `"antigravity"`). |
| `nexus.antigravity.path` | `string` | `""` | Chemin d'accès absolu vers le binaire `agy`. Si laissé vide, `agy` est résolu via le `PATH`. |
| `nexus.antigravity.sandbox` | `boolean` | `true` | Exécute Antigravity en mode bac à sable (`--sandbox`). |
| `nexus.antigravity.dangerouslySkipPermissions` | `boolean` | `false` | Ignore les demandes de confirmation pour les commandes système (`--dangerously-skip-permissions`). Fortement déconseillé en production. |

### Exemple de configuration (`settings.json`)

```json
{
  "nexus.defaultBackend": "antigravity",
  "nexus.antigravity.path": "/home/kaox/.local/bin/agy",
  "nexus.antigravity.sandbox": true,
  "nexus.antigravity.dangerouslySkipPermissions": false
}
```

## Commandes VS Code

Depuis la palette de commandes de VS Code (`Ctrl+Shift+P` / `Cmd+Shift+P`) :

- **Nexus: Test Antigravity Connection** (`nexus.testAntigravity`) : vérifie l'installation du binaire `agy` et charge le catalogue de modèles.
- **Nexus: Select Active Backend** (`nexus.selectBackend`) : bascule instantanément le backend actif entre Codex et Gemini Antigravity.
- **Nexus: Start Antigravity Session** (`nexus.startAntigravitySession`) : démarre ou réutilise une session Antigravity dans le workspace ouvert.
- **Nexus: New Antigravity Session** (`nexus.newAntigravitySession`) : force la création d'une nouvelle session Antigravity.
- **Nexus: Resume Antigravity Session** (`nexus.resumeAntigravitySession`) : reprend une session existante par son identifiant.
- **Nexus: Test Antigravity Prompt** (`nexus.testAntigravityPrompt`) : teste l'envoi d'un prompt simple à Antigravity.

## Sécurité et Sandboxing

Comme pour Codex, Nexus applique les mêmes garanties strictes de sécurité pour Antigravity :
- **Validation pré-vol du workspace** : vérification de l'absence de modifications non sauvegardées, verrouillage Git, détection des branches protégées (`main`, `master`).
- **Isolation par workspace** : chaque session et préférence de modèle est hermétiquement cantonnée au dossier ouvert.
- **Flag `--sandbox`** : Antigravity est exécuté avec l'isolation de sécurité activée par défaut.
