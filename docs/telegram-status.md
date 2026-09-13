# Statut Telegram : /status

Envoyer `/status` au bot depuis le compte appairé, en conversation privée.
La commande consulte l'état local de Nexus : elle ne démarre ni processus
Codex, ni session, ni turn, et ne demande aucune approbation.

## Informations affichées

Le message présente un titre en gras, puis trois blocs espacés : **Projet**,
**Codex** et **Activité**. La connexion Telegram reste visible en tête.
Les sections sont repérées par 📁, 🤖 et ⚡. Les états utilisent 🟢 pour une
connexion/session active, ⚪ pour l'absence de session ou de turn, 🟠 pour une
reprise nécessaire ou une approbation attendue, 🔴 pour une indisponibilité et
⏳ pour une opération en cours.
Les informations et les alertes existantes sont conservées ; les noms de
workspaces, chemins et identifiants contenant du Markdown restent littéraux.

- **Workspace ciblé** : nom et chemin du premier dossier ouvert dans la fenêtre
  VS Code de Nexus. Si plusieurs dossiers sont ouverts, le statut précise leur
  nombre et que le premier est ciblé, conformément au comportement actuel.
- **Telegram** : connexion et appairage ; présence d'une requête `/codex` en cours
  de traitement, y compris son démarrage ou l'envoi de sa réponse.
- **Processus Codex** : lancé ou arrêté.
- **Session Codex** : état, identifiant et workspace associé. Une session connue
  dont le processus s'est arrêté est indiquée comme indisponible. Si le processus
  a redémarré sans avoir pu recharger la session, elle est indiquée « à reprendre ».
  Une création ou reprise explicite affiche aussi « Gestion de session : en cours ».
- **Turn** : démarrage, exécution ou attente d'approbation, identifiant dès qu'il
  est reçu, et durée écoulée en secondes depuis l'envoi de `turn/start`.
  Après le délai de 120 secondes, affiche « interruption en cours » pendant
  l'attente de confirmation, au maximum cinq secondes supplémentaires.
- **Approbations en attente** : nombre de demandes encore ouvertes côté Nexus.

Le workspace de la session est affiché séparément du workspace ciblé. Un message
signale leur différence éventuelle ; `/status` ne change pas de session et ne
bloque pas les prompts.

Le statut est recalculé à chaque commande. Un message déjà envoyé ne se met pas
à jour automatiquement. La durée du turn inclut l'attente d'une approbation.

Ce statut décrit le suivi local de Nexus. Au timeout, Nexus demande l'interruption
et attend la notification de fin avant de libérer le turn. Sans confirmation sous
cinq secondes, il ferme la connexion et demande l'arrêt du processus. Un processus
affiché arrêté correspond alors à une connexion fermée : cela ne garantit pas
l'arrêt de toutes les commandes enfants. Le message d'erreur précise cette
incertitude. Voir [la gestion des erreurs](codex-errors.md) et
[la reprise de session](codex-sessions.md).

## Tester simplement

1. Dans le terminal du projet, exécuter `npm run compile`.
2. Arrêter l'ancienne exécution de débogage si elle tourne, puis relancer avec
   **F5**. Garder un dossier de test ouvert dans l'Extension Development Host.
   L'appairage Telegram existant est conservé.
3. Envoyer `/status` : le nom et le chemin doivent correspondre au dossier ouvert.
   Vérifier que le titre et les intitulés Projet, Codex et Activité sont en gras,
   avec une ligne vide entre les blocs et sans astérisques affichés.
   Au démarrage de l'extension, avant tout prompt ou démarrage manuel de session,
   les lignes attendues sont :

   ```text
   Processus Codex : arrêté
   Session Codex : aucune
   Turn : aucun en cours
   Approbations en attente : 0
   ```

4. Envoyer :

   ```text
   /codex Exécute sleep 20 puis réponds uniquement Terminé.
   ```

   Pendant l'attente, envoyer `/status` : la session doit être active, avec son
   identifiant et son workspace. Le turn doit être en cours avec un identifiant
   et une durée. Après la réponse finale, renvoyer `/status` : la session reste
   active avec le même identifiant, et aucun turn n'est en cours.

5. Pour tester l'attente d'approbation, envoyer l'instruction déjà validée à
   l'étape 1 :

   ```text
   /codex Exécute uniquement pwd en demandant explicitement une autorisation de sortie du sandbox avec sandbox_permissions=require_escalated.
   ```

   Quand les boutons apparaissent, envoyer `/status` **avant de cliquer** :
   `Turn : en attente d’approbation (…)` et `Approbations en attente : 1` doivent
   apparaître. Cliquer sur **Refuser**, puis renvoyer `/status` : le compteur
   revient à zéro. Codex peut encore terminer sa réponse avant la fin du turn.

Optionnel : tester sans dossier ouvert pour voir `Workspace ciblé : aucun`, ou
avec plusieurs dossiers pour voir lequel est ciblé. `/status` fonctionne sans
avoir lancé de session Codex.

## Tests automatisés

```sh
npm run test:unit
npm run compile
```

Les tests de statut couvrent l'absence de workspace/session, les snapshots du
cycle de vie Codex, les approbations, la réponse pendant un prompt, le contrôle
de l'utilisateur/chat, les workspaces distincts et l'indisponibilité du processus.
Ils utilisent des transports simulés et ne contactent aucun bot réel.
