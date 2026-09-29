# Gestion de la mémoire et personnalisation des agents dans Nexus

Ce document décrit l'architecture de mémoire de Nexus, conçue pour être **équilibrée, performante et efficace**.

---

## 1. Vue d'ensemble des niveaux de mémoire

| Niveau | Emplacement | Rôle | Persistance |
|---|---|---|---|
| **Décisions architecturales (ADR)** | `<projet>/.nexus/memory.md` | Consigne les choix techniques et règles structurantes du projet. | Fichier Markdown suivi (Git). |
| **Directives & Préférences** | `<projet>/.nexus/preferences.md`<br>`~/.nexus/preferences.md` | Détermine le ton, la langue, les conventions de code (ex: TypeScript strict, Biome). | Fichier Markdown local et/ou global. |
| **Historique Brain** | `~/.nexus/brain-sessions/*.json` | Conserve les échanges avec Nexus Brain au fil des redémarrages. | Fichier JSON compact (max 20 messages, observations condensées). |
| **Sessions de code** | `.nexus/sessions/*.json` | Maintient le fil d'exécution Codex (`threadId`) et Antigravity (`conversationId`). | État de workspace VS Code ou fichier local. |

---

## 2. Injection automatique de contexte (Prompt Augmentation)

Lors de l'appel à `NexusRuntime.executeTask` pour **Codex** et **Gemini Antigravity** :

1. `ProjectMemory.augmentPrompt(prompt, rootPath)` inspecte le projet.
2. Si des décisions actives (`status: 'accepted'`) ou des préférences existent, le prompt est enrichi automatiquement :

```markdown
[CONTEXTE PROJET & DIRECTIVES NEXUS]
Directives et préférences du développeur :
• Langue : Français
• Style : TypeScript strict, Biome, pas de any

Décisions architecturales actives validées :
• [2026-09-28] Architecture API : Format standard { status, data, error }.

Consigne : Applique strictement ces choix et directives dans ta réponse ou ton implémentation.

[DEMANDE UTILISATEUR]
<votre instruction>
```

3. **Garantie de performance et sobriété** :
   - Si aucun fichier de mémoire ou de préférence n'est présent, **le prompt reste brut et intact** (zéro surcoût en tokens).
   - Les requêtes de heartbeat / diagnostics (ex: `Reply only with:...`) ne sont pas altérées.
   - Les décisions sont bornées en taille (max 2 000 caractères) pour ne pas saturer la fenêtre de contexte du modèle.

---

## 3. Contexte immédiat pour Nexus Brain

Dans `NexusRuntime.executeBrain` :
- Les décisions actives et préférences sont injectées dès le tour initial dans les métadonnées `ConversationProjectContext` (`decisionsSummary`, `preferences`).
- Le system prompt du Brain (`brainSystemPrompt`) les intègre directement, évitant ainsi un appel d'outil préalable pour connaître l'architecture du projet.
- Brain conserve les outils `get_project_memory` et `record_decision` pour consulter l'intégralité du journal ou enregistrer de nouvelles décisions au fil de la discussion.

---

## 4. Persistance des sessions Brain sur disque (`FileBrainSessionPersistence`)

Pour éviter l'amnésie de Nexus Brain lors du redémarrage de la machine ou de l'extension :
- Chaque fil de discussion Brain est sauvegardé dans `~/.nexus/brain-sessions/<id>.json`.
- **Régulation de taille** :
  - Fenêtre glissante limitée aux **20 derniers messages** récents (~10 tours de dialogue).
  - Les résultats d'outils volumineux (comme `inspect_project`) antérieurs aux deux derniers tours sont automatiquement condensés à max 300 caractères lors de la sauvegarde.
  - La taille de chaque session sur disque reste ainsi sous les **15 Ko**.
- **Réinitialisation** :
  - L'utilisateur peut réinitialiser la conversation Brain à tout moment en envoyant `/reset` ou `reset` dans la conversation Brain.
