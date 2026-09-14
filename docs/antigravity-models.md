# Sélection des modèles et raisonnement Antigravity

Nexus permet de consulter la liste des modèles Gemini supportés par Antigravity et d'ajuster leur effort de raisonnement directement depuis Telegram ou VS Code.

## Découverte du catalogue de modèles

Le catalogue des modèles est obtenu en interrogeant la CLI `agy` :
```bash
agy models
```
Exemples de modèles supportés :
- `gemini-2.5-pro` (par défaut) : raisonnement complexe, analyse de code avancée, multi-fichiers.
- `gemini-2.5-flash` : vitesse d'exécution élevée, vérifications et modifications ciblées.

## Niveaux d'effort de raisonnement

Chaque modèle supporte plusieurs niveaux d'effort de pensée (`reasoningEffort`) :
- `low` : raisonnement rapide, idéal pour les questions simples ou les corrections directes.
- `medium` : équilibre entre profondeur de réflexion et temps de réponse (par défaut pour les modèles Pro).
- `high` : réflexion approfondie, planification minutieuse pour les refactorisations complexes.

## Menu interactif Telegram `/model`

Lorsque Antigravity est le backend actif (`/backend antigravity`) :

1. L'utilisateur saisit `/model` dans la conversation Telegram avec le bot.
2. Nexus affiche un clavier interactif paginé (boutons inline) :
   ```text
   ✨ Nexus — modèles Antigravity (1/1)

   Choisissez un modèle, puis son effort de raisonnement.
   ✓ Modèle sélectionné · ☆ Modèle par défaut
   Ce choix sera conservé pour ce workspace.
   Le menu expire après 2 minutes.
   ```
3. L'utilisateur clique sur le modèle de son choix (ex: `Gemini 2.5 Pro`).
4. Nexus présente les options d'effort disponibles (`low`, `medium`, `high`).
5. Le choix est immédiatement sauvegardé pour le workspace ouvert (`nexus.antigravity.model`).
6. La confirmation est envoyée :
   ```text
   ✅ Modèle choisi : Gemini 2.5 Pro
   Raisonnement : high
   Appliqué à la prochaine demande /antigravity.
   ```

## Persistance

Le modèle sélectionné et son effort de raisonnement sont enregistrés dans le stockage de l'espace de travail VS Code (`WorkspaceAntigravityModelPreferences`).
Le choix est persistant et s'applique automatiquement à tous les futurs prompts de cette session dans ce dossier.
