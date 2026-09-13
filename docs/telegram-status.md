# Statut Telegram : /status

Envoyer `/status` au bot depuis le compte appairé, en conversation privée.
La commande consulte l'état local de Nexus : elle ne démarre ni processus
Codex, ni session, ni turn, et ne demande aucune approbation.

## Informations affichées

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
- **Approbations en attente** : nombre de demandes encore ouvertes côté Nexus.

Le workspace de la session est affiché séparément du workspace ciblé. Un message
signale leur différence éventuelle ; `/status` ne change pas de session et ne
bloque pas les prompts.

Le statut est recalculé à chaque commande. Un message déjà envoyé ne se met pas
à jour automatiquement. La durée du turn inclut l'attente d'une approbation.

Ce statut décrit le suivi local de Nexus, sans interroger Codex pour confirmer
l'état distant. Après le timeout de turn existant de 120 secondes, Nexus ne suit
plus ce turn ; cela ne confirme pas l'arrêt de son exécution côté Codex. La
gestion complète des erreurs reste une étape suivante du projet. La reprise
explicite est décrite dans [le guide des sessions](codex-sessions.md).

## Tester simplement

1. Dans le terminal du projet, exécuter `npm run compile`.
2. Arrêter l'ancienne exécution de débogage si elle tourne, puis relancer avec
   **F5**. Garder un dossier de test ouvert dans l'Extension Development Host.
   L'appairage Telegram existant est conservé.
3. Envoyer `/status` : le nom et le chemin doivent correspondre au dossier ouvert.
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
