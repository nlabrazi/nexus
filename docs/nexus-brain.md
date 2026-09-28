# Nexus Brain — contrat du premier spike

Ce premier changement définit uniquement le contrat `ConversationalAgent` dans
[`src/conversational/types.ts`](../src/conversational/types.ts). Il ne fournit pas
encore de moteur conversationnel et n'est pas branché à l'extension. Les parcours
Telegram, Codex, Antigravity et voix existants restent inchangés.

## Responsabilités

| Couche | Responsabilités |
| --- | --- |
| ConversationalAgent | Comprendre la demande, clarifier, proposer une inspection, demander le consentement, déléguer et synthétiser le résultat. |
| Futur pont d'outils | Vérifier la cible, les autorisations et le périmètre avant de déléguer aux services existants. |
| CodexService / AntigravityService | Gérer les sessions techniques, exécuter les opérations sur le dépôt, appliquer les contrôles workspace et gérer l'annulation. |
| Telegram | Transporter les messages et afficher les réponses et demandes d'approbation. |

Le Brain ne reçoit pas directement de shell, d'accès au filesystem ni de client
Codex ou Antigravity. Son contrat ne dépend ni de ces backends, ni de Telegram,
ni de VS Code. Il ne cherche pas à unifier toutes les capacités des deux agents.

## Contrat conversationnel

`respond(input, signal)` reçoit un message utilisateur et renvoie une réponse
textuelle destinée à l'utilisateur. Cette réponse peut être une clarification,
une proposition ou une synthèse ; elle n'est jamais une autorisation exécutable.
Les contrats des outils et du consentement seront définis avec le pont d'outils.

`conversationId` identifie le dialogue Nexus. Il est indépendant du `threadId`
Codex et du `conversationId` Antigravity. La future implémentation du Brain sera
responsable de son état de dialogue, initialement en mémoire. Les services
existants restent responsables de leurs propres sessions et de leur persistance.
Ce commit n'ajoute ni historique persistant ni mémoire projet.

Le contexte projet optionnel contient seulement un nom et une branche éventuelle,
fournis par l'application. Ces informations servent à discuter ; elles ne
désignent pas une cible d'exécution fiable et n'accordent aucun accès. Le futur
pont devra résoudre le workspace réel côté application et le revalider avant
chaque délégation. L'absence de contexte permet de discuter sans projet ouvert ;
elle ne permet pas de lancer une inspection sans cible validée.

L'`AbortSignal` est obligatoire. La future implémentation devra rejeter un tour
annulé, cesser toute nouvelle délégation pour ce tour et propager l'annulation
au travail technique en cours. L'annulation ne restaure pas les éventuelles
modifications déjà effectuées.

## Frontières de sécurité à conserver

Le consentement conversationnel (« oui, inspecte ce projet ») et les approvals
techniques d'une commande ou modification sont deux décisions distinctes.
Un accord doit être associé à une action précise en attente et à sa cible.
Le modèle ne peut pas s'accorder lui-même une autorisation. Une autorisation
absente, refusée, expirée ou devenue invalide doit bloquer la délégation.

Les contrôles `WorkspaceGuard` et les mécanismes d'approbation existants doivent
rester sur le parcours d'exécution. Ajouter « ne modifie rien » à un prompt ne
garantit pas une inspection en lecture seule :

- Codex démarre actuellement ses sessions en `workspace-write`.
- Antigravity reçoit systématiquement `--dangerously-skip-permissions`. La
  supervision Nexus réagit notamment à des événements d'outil `ACTIVE` ; ce
  mécanisme ne démontre pas un blocage avant l'exécution de l'action.

Avant d'activer `inspect_project`, le pont devra disposer d'une restriction
technique vérifiée pour le backend utilisé. Si cette garantie manque, l'outil
doit rester indisponible. Les corrections nécessaires seront traitées dans
un changement dédié, sans modifier les backends dans ce premier commit.

## Étapes suivantes

1. Introduire le pont avec au plus deux outils initiaux : `get_project_status`
   et `inspect_project`. Réutiliser les services existants et tester les refus,
   l'annulation et les changements de contexte.
2. Implémenter le spike conversationnel et son accès expérimental via Telegram.
   Vérifier un moteur utilisable sans coût récurrent supplémentaire, avec un
   contexte distinct de la session de travail et des outils restreints.
3. Comparer cette expérience à l'usage direct de Codex, puis s'arrêter pour
   évaluer les clarifications, la synthèse, la latence et l'utilité réelle.

Core, VPS, PWA, Desktop Daemon, registre multi-projets, mémoire, modifications
voix et refonte générale des backends sont hors du périmètre de ce spike.

## Validation de ce premier changement

Exécuter `npm run check-types` et `npm run lint`. Ce commit n'ajoute que des
interfaces et cette note ; aucun comportement exécutable ne justifie de nouveau
test unitaire. Les garanties décrites pour la future implémentation devront être
testées lors de son introduction, elles ne sont pas imposées par les types seuls.
