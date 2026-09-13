# Approbations Codex via Telegram

Nexus transmet les demandes d'autorisation du processus `codex app-server`
au compte Telegram appairé. Le compte et le chat privé doivent tous deux
correspondre à l'appairage enregistré dans VS Code.

## Fonctionnement

- Les demandes de commande et de modification de fichiers proposent
  **Autoriser une fois** et **Refuser**. L'autorisation produit uniquement
  `decision: "accept"`, jamais `acceptForSession` ni une règle permanente.
- Le délai est de **60 secondes à compter de la réception de la demande**.
  L'absence de réponse produit `decision: "decline"`.
- Le message affiche les paramètres de la demande et, lorsqu'il existe,
  l'item Codex associé : commande, répertoire, motif, destination réseau ou
  changements de fichiers. Le contenu est envoyé en texte brut.
- Les demandes sans action consultable, ou dépassant 4 000 caractères avec
  leur contexte, sont refusées. Une demande trop longue n'est pas tronquée
  avant autorisation.
- Le premier clic valide consomme la demande. Les autres clics, les anciens
  boutons après redémarrage et les callbacks provenant d'un autre utilisateur,
  chat ou message ne peuvent pas autoriser l'action.
- Les boutons sont retirés après décision ou annulation. Si Telegram refuse
  la mise à jour du message, les boutons restants sont déjà invalides côté Nexus.
- Un arrêt/reparamétrage de Telegram, un nouvel appairage, une erreur de polling,
  une fin ou un timeout de turn annulent les demandes en attente. Une sortie du
  processus Codex ou une notification `serverRequest/resolved` invalide les
  boutons sans renvoyer de réponse à une demande déjà supprimée par Codex.

Les demandes `item/permissions/requestApproval` restent refusées avec
`permissions: {}` et `scope: "turn"` : ce protocole accorde des permissions pour
un turn ou une session et ne correspond pas à une autorisation ponctuelle.
Les requêtes serveur non prises en charge reçoivent une erreur JSON-RPC
`-32601` (méthode inconnue).

Le polling Telegram continue pendant l'exécution de `/codex` pour pouvoir
recevoir les clics. Une seconde instruction `/codex` est rejetée tant que
la première est en cours. Les approvals ne sont pas persistées.

## Validation automatisée

Avec Node.js 24 et les dépendances du projet installées :

```sh
npm run test:unit
npm run compile
```

Les tests utilisent le runner intégré à Node, des horloges contrôlées,
un transport Codex simulé et un client Telegram simulé. Ils ne contactent
aucun bot et ne lancent aucun véritable prompt Codex.
`npm test` conserve le test d'extension VS Code existant.

## Vérification manuelle dans VS Code

1. Compiler l'extension et lancer l'Extension Development Host avec F5.
2. Configurer Telegram avec `Nexus: Configure Telegram`, puis utiliser
   `Nexus: Pair Telegram` et envoyer le code d'appairage au bot en chat privé.
3. Dans un workspace de test, envoyer `/codex` avec une instruction qui
   déclenche réellement une demande d'approbation selon le sandbox Codex.
   Une commande déjà autorisée par le sandbox ne provoque pas de bouton.
4. Vérifier séparément **Autoriser une fois**, **Refuser**, l'absence de clic
   pendant 60 secondes, puis un second clic sur une demande déjà traitée.
5. Reconfigurer Telegram pendant une demande et vérifier que son ancien bouton
   n'autorise plus rien. Vérifier aussi l'expiration du turn pendant une demande.

Le timeout de turn existant reste fixé à 120 secondes, temps d'approbation
compris. Si ce délai est atteint avant les 60 secondes de l'approval,
la demande est annulée dès la fin du turn.

## Références du protocole

- [Codex App Server — Approvals](https://learn.chatgpt.com/docs/app-server#approvals).
- [Telegram Bot API — CallbackQuery](https://core.telegram.org/bots/api#callbackquery).
- Les formats ont aussi été vérifiés avec les types produits localement par
  `codex app-server generate-ts` dans Codex CLI 0.154.0.
