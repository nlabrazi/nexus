# Tester Nexus avec F5

Depuis la fenêtre VS Code contenant le code source Nexus :

1. Arrêter l’ancienne exécution avec **Shift+F5** si elle tourne.
2. Si Nexus est aussi installé dans la fenêtre de travail habituelle, le désactiver
   pour ce workspace depuis la vue Extensions, puis effectuer le redémarrage demandé
   par VS Code. Fermer également les autres fenêtres qui utilisent le même bot.
3. Choisir **Run Extension**, puis **F5**.
4. Envoyer `/status` au bot : le workspace doit être `project`, avec un chemin
   se terminant par `.nexus-dev/project`.
5. Tester les commandes dans le bot Telegram déjà appairé.

Une seule instance doit interroger Telegram avec le même token. La version installée
et la version lancée avec F5 peuvent sinon récupérer les messages l’une à la place
de l’autre. Une ancienne version sans support vocal peut recevoir puis ignorer un
vocal : il ne sera alors plus proposé à la version de test après confirmation de
l’offset. Voir [le fonctionnement de `getUpdates`](https://core.telegram.org/bots/api#getupdates).

Un `/status` affichant le projet `nexus` au lieu de `.nexus-dev/project` indique
qu’une autre fenêtre répond, ou que le lancement n’utilise pas cette configuration
F5. Vérifier ce point avant de tester les vocaux. La désactivation pour le workspace
est décrite dans la [documentation VS Code](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#disable-an-extension).

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
