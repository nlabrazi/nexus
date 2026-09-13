# Tester Nexus avec F5

Depuis la fenêtre VS Code contenant le code source Nexus :

1. Arrêter l’ancienne exécution avec **Shift+F5** si elle tourne.
2. Choisir **Run Extension**, puis **F5**.
3. Tester les commandes dans le bot Telegram déjà appairé.

F5 compile l’extension puis prépare automatiquement `.nexus-dev/project`.
Ce dossier possède son propre dépôt Git, créé sur la branche `nexus-test`.
La fenêtre de développement ouvre explicitement cette racine : elle ne réutilise
plus un ancien dossier tel que `src`. Le projet Nexus reste ouvert dans votre
fenêtre de travail habituelle.

La configuration de lancement utilise `--disable-workspace-trust` pour cette
fenêtre de développement, comme le permet [VS Code](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust).
Ce lancement est destiné au projet de test généré ; les contrôles de confiance
restent présents dans le code de Nexus. Aucun paramètre global de confiance
n’est modifié. Pour tester spécifiquement le mode restreint, retirer cet argument
de la configuration de lancement avant F5.

La préparation conserve les fichiers, l’index et la branche existants. Elle ne
réinitialise pas les modifications faites lors des essais. Si un test précédent
a laissé une opération Git en cours ou une branche protégée, les contrôles Nexus
continuent de la bloquer. Le dossier `.nexus-dev` est ignoré par Git et exclu du VSIX.
La compilation est refaite à chaque lancement F5 ; les tâches watch restent
disponibles séparément.

Pour vérifier la préparation sans ouvrir la fenêtre : `npm run dev:prepare`.
Git et les dépendances npm doivent être installés. Les essais Telegram nécessitent
Codex disponible/authentifié et l’appairage existant ; cette préparation ne touche
pas aux identifiants ni aux secrets.

## Vérification rapide de /stop

1. `/status` → workspace `project`, chemin se terminant par `.nexus-dev/project`.
2. `/codex Exécute sleep 30 puis réponds Terminé.`
3. Pendant le turn : `/stop` → message d’annulation.
4. `/status` → aucun turn, session sélectionnée conservée mais indisponible.
5. `/codex Réponds uniquement OK.` → reprise de la même session si elle est disponible.

Voir [les autres scénarios /stop](telegram-stop.md).
