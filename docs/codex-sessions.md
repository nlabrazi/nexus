# Créer et reprendre une session Codex

Nexus sélectionne une conversation Codex à la fois dans sa fenêtre VS Code.
L'« ID session » affiché par Nexus correspond au `thread.id` utilisé par les RPC
Codex. La sélection, son workspace et sa branche sont sauvegardés dans le stockage
du workspace VS Code ; l’historique de conversation reste géré par Codex.

## Commandes

| Commande Telegram | Comportement |
| --- | --- |
| `/codex <instruction>` | Réutilise la conversation sélectionnée. En crée une uniquement si aucune n'est sélectionnée. |
| `/new` | Crée et sélectionne volontairement une nouvelle conversation dans le workspace ciblé. |
| `/resume <id>` | Reprend et sélectionne cette conversation après vérification de son workspace. |
| `/status` | Affiche la sélection actuelle, son identifiant et son état. |

Les anciennes conversations ne sont ni supprimées ni archivées par `/new`.
Leur historique reste géré par Codex. Pour les retrouver, conserver leur
identifiant affiché par `/status` ou par les commandes de session.

Les mêmes actions sont disponibles dans la palette VS Code :

- **Nexus: Start Codex Session** : obtenir la session actuelle, la reprendre
  si son processus a disparu, ou en créer une si aucune n'est sélectionnée.
- **Nexus: New Codex Session** : créer une nouvelle conversation explicitement.
- **Nexus: Resume Codex Session** : saisir l'identifiant de la conversation à reprendre.

## Garanties et limites

- Deux demandes simultanées d'obtention de la même session partagent une seule
  opération. L'initialisation du processus est également partagée jusqu'à la
  fin du handshake.
- `/new` n'est pas mis en file d'attente : s'il arrive pendant une opération ou
  un prompt, il est refusé. Deux `/new` envoyés successivement **après** leurs
  confirmations créent volontairement deux conversations.
- La réservation d'un prompt couvre sa création/reprise de session et son turn.
  Une autre commande ne peut pas changer la sélection entre les deux.
- Une reprise utilise `thread/read`, puis `thread/resume`, avec les politiques
  `on-request`, revue par l'utilisateur et sandbox `workspace-write`.
- Le workspace de la conversation doit correspondre au dossier ciblé. Une
  conversation signalée active ou en erreur par Codex n'est pas adoptée.
- Une erreur de reprise ne déclenche jamais une création de remplacement.
  La sélection précédente reste inchangée ; si son processus a disparu, elle
  est affichée comme indisponible ou à reprendre.
- Après disparition du processus Codex, un prochain prompt tente de reprendre
  l'identifiant encore connu en mémoire.
- Après fermeture/rechargement de l’extension, la sélection est restaurée inactive.
  Le prochain prompt tente sa reprise ; `/resume <id>` reste disponible pour choisir
  explicitement une autre conversation. Voir [la persistance](session-persistence.md).
  Une conversation doit avoir été enregistrée par Codex pour être reprise : tester
  avec au moins un prompt terminé.

Les verrous concernent cette instance de Nexus, pas les autres fenêtres ou
clients Codex. Une session signalée introuvable pendant un prompt est marquée
inactive, avec son identifiant conservé. Un prochain prompt doit la reprendre
avant de pouvoir démarrer un turn ; aucune session de remplacement n'est créée
automatiquement. Le timeout et les erreurs sont décrits dans
[le guide dédié](codex-errors.md). La commande Telegram `/stop` est décrite dans [le guide d’annulation](telegram-stop.md).

## Test manuel simple

1. Exécuter `npm run compile`, arrêter l'ancienne exécution de débogage puis
   relancer **F5**. Garder le même workspace de test ouvert.
2. Envoyer au bot :

   ```text
   /codex Le repère de cette conversation est LUNE-742. Réponds seulement « noté », sans écrire de fichier.
   ```

3. Après la réponse, envoyer `/status` et copier l'**ID session A**. Envoyer un
   second prompt, puis `/status` : l'identifiant doit rester A.
4. Envoyer `/new`, attendre la confirmation, puis `/status` : l'identifiant B
   doit être différent de A.
5. Envoyer `/resume ID_A` en remplaçant `ID_A` par l'identifiant copié. Après la
   confirmation, `/status` doit à nouveau afficher A. Envoyer :

   ```text
   /codex Quel est le repère donné dans cette conversation ? Réponds uniquement avec ce repère, sans lire de fichier.
   ```

   La réponse attendue est `LUNE-742`.
6. Envoyer `/resume session-inexistante`, puis `/status` : une erreur est
   affichée et A reste sélectionnée.
7. Envoyer `/codex Exécute sleep 20 puis réponds uniquement Terminé.`, puis
   `/new` pendant l'exécution : la création est refusée. `/status` reste disponible.

Pour tester la reprise après redémarrage : conserver A, arrêter puis relancer
la fenêtre de test dans le même workspace. `/status` doit retrouver A sans lancer
Codex ; poser ensuite à nouveau la question du repère pour déclencher la reprise.

## Validation automatisée

```sh
npm run test:unit
npm run compile
```

Les tests utilisent des processus et transports simulés. Ils vérifient la
concurrence, les requêtes de reprise, les workspaces incompatibles, la perte
d'une session, les réponses tardives après arrêt et les commandes Telegram.
Ils ne contactent aucun bot et ne lancent aucun prompt Codex réel.

Protocole : [Codex App Server — Lifecycle overview](https://learn.chatgpt.com/docs/app-server#lifecycle-overview).

## Contrôles workspace et branche

Les sessions sont associées à la racine canonique du projet et à la branche Git.
Un changement de branche exige de revenir au contexte précédent, ou de choisir
explicitement `/new` ou `/resume <id>`. Les branches `main` et `master` sont
protégées par défaut. Voir [les règles et consignes de test](workspace-safety.md).
