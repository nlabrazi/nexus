# Statut Telegram : /status

Envoyer `/status` au bot depuis le compte appairé, en conversation privée.
La commande consulte l’état local de Nexus et les mesures reçues de Codex. Si le
processus est connecté, elle actualise aussi les quotas du compte (délai maximal
de trois secondes). Elle ne démarre ni processus Codex, ni session, ni turn, et ne
demande aucune approbation. Le polling continue pendant cette actualisation.

## Informations affichées

Le message présente un titre en gras, puis des blocs espacés : **Projet**,
le **Backend actif** (`🤖 Codex` ou `✨ Gemini Antigravity`), puis les sections dédiées :
**Codex** et/ou **Gemini Antigravity**, **Modèle et configuration**, **Tokens de la session**,
**Quotas du compte Codex** et **Activité**. La connexion Telegram reste visible en tête.
Les sections sont repérées par des icônes. Les états utilisent 🟢 pour une
connexion/session active, ⚪ pour l'absence de session ou de turn, 🟠 pour une
reprise nécessaire ou une approbation attendue, 🔴 pour une indisponibilité et
⏳ pour une opération en cours.
Les informations et les alertes existantes sont conservées ; les noms de
workspaces, chemins et identifiants contenant du Markdown restent littéraux.

- **Backend actif** : indique si les commandes génériques (`/new`, `/resume`, `/model`) s'adressent à Codex ou à Gemini Antigravity. Configurable via `/backend [codex|antigravity]`.
- **Workspace ciblé** : nom et chemin du seul dossier ouvert dans la fenêtre
  VS Code de Nexus. Si plusieurs dossiers sont ouverts, le statut précise leur
  nombre et signale que les actions agents sont bloquées car la cible est ambiguë.
- **Telegram** : connexion et appairage ; présence d'une requête `/codex` ou `/antigravity` en cours
  de traitement, y compris son démarrage ou l'envoi de sa réponse.
- **Processus Codex** : lancé ou arrêté.
- **Session Codex** : état, identifiant, workspace associé et branche mémorisée à la sélection
  de la session (sans nouvelle lecture de Git). Une session connue
  dont le processus s'est arrêté est indiquée comme indisponible. Si le processus
  a redémarré sans avoir pu recharger la session, elle est indiquée « à reprendre ».
  Une création ou reprise explicite affiche aussi « Gestion de session : en cours ».
- **Turn** : démarrage, exécution ou attente d'approbation, identifiant dès qu'il
  est reçu, et durée écoulée en secondes depuis l'envoi de `turn/start`.
  Après le délai de 120 secondes, affiche « interruption en cours » pendant
  l'attente de confirmation, au maximum cinq secondes supplémentaires.
- **Approbations en attente** : nombre de demandes encore ouvertes côté Nexus.
- **Modèle et configuration** : modèle, fournisseur, effort de raisonnement,
  service, sandbox et politique d’approbation lorsqu’ils sont communiqués par
  Codex. Un choix `/model` prévu pour le prochain prompt est affiché séparément.
  Une redirection de modèle signalée par le serveur est également indiquée.
- **Tokens de la session** : total cumulé, tokens d’entrée (dont cache lu),
  tokens de sortie (dont raisonnement), cache écrit si communiqué et nombre de
  tokens du dernier appel. Les mises à jour remplacent les compteurs précédents :
  Nexus ne les additionne pas. Le cache lu et le raisonnement sont des sous-totaux,
  pas des tokens à ajouter une seconde fois au total.
- **Contexte** : dernière mesure `last.totalTokens` rapportée à
  `modelContextWindow`, avec un pourcentage restant approximatif. Ce ratio brut
  n’applique pas les réserves internes éventuelles de l’interface CLI. Le total
  cumulé d’une conversation n’est pas sa taille de contexte. La date de réception
  permet de savoir à quand remonte la mesure, notamment après une compaction ou
  un changement de modèle.
- **Quotas** : chaque compteur renvoyé par le compte conserve ses fenêtres
  principale et secondaire, avec durée, pourcentage consommé/restant, offre si
  connue, et date de réinitialisation. Les dates utilisent `Europe/Paris`. Les
  fenêtres ne sont pas supposées fixes : Nexus affiche celles fournies par Codex.
  Une erreur ou un compte incompatible conserve les dernières valeurs reçues en
  les marquant non actualisées. Sans mesure, le statut indique « indisponible ».

Le workspace de la session est affiché séparément du workspace ciblé. Un message
signale leur différence éventuelle ; `/status` ne change pas de session et ne
bloque pas les prompts.

Le statut est recalculé à chaque commande. Un message déjà envoyé ne se met pas
à jour automatiquement. La durée du turn inclut l'attente d'une approbation.

Ce statut décrit la session pilotée par Nexus et les quotas de son compte Codex,
pas une conversation CLI indépendante. Les tokens proviennent des notifications
`thread/tokenUsage/updated`, les quotas de `account/rateLimits/read` et
`account/rateLimits/updated`. Aucune estimation de coût ou de facturation n’est
calculée. Voir le [protocole App Server](https://developers.openai.com/codex/app-server/).

Au timeout d’un turn, Nexus demande l'interruption
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
   Sur un workspace sans session mémorisée, avant tout prompt ou démarrage manuel
   de session, les lignes attendues sont :

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
avec plusieurs dossiers pour voir le blocage des actions Codex. `/status` fonctionne sans
avoir lancé de session Codex.

## Tests automatisés

```sh
npm run test:unit
npm run compile
```

Les tests de statut couvrent l'absence de workspace/session, les snapshots du
cycle de vie Codex, les approbations, la réponse pendant un prompt, le contrôle
de l'utilisateur/chat, les workspaces distincts, l’indisponibilité du processus,
les compteurs de tokens, les quotas et leur timeout, les données inconnues ou
périmées, les réponses tardives et la séparation entre modèle choisi et confirmé.
Ils utilisent des transports simulés et ne contactent aucun bot réel.

Après redémarrage, une sélection sauvegardée apparaît inactive avec son identifiant
et sa branche. `/status` ne la reprend pas : voir [la persistance](session-persistence.md).
Les mesures de tokens et de quotas ne sont pas persistées par Nexus : elles
restent indisponibles jusqu’à leur prochaine réception. Les préférences de
modèle sont sauvegardées séparément : voir [/model](telegram-models.md).
