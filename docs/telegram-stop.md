# Commande Telegram /stop

`/stop` annule la requête Codex en cours depuis le compte appairé, dans la
conversation privée appairée. Aucun argument n’est accepté.

- Pendant un prompt, une approbation, la validation du workspace ou une création/
  reprise de session : Nexus annule son suivi, ferme la connexion Codex et demande
  l’arrêt du processus s’il est lancé. Les approbations sont invalidées.
- Sans requête en cours : « ⚪ Aucune requête Codex en cours. » La session et son
  processus au repos sont conservés.
- L’identifiant, le workspace et la branche de la session déjà sélectionnée restent
  en mémoire. La prochaine instruction explicite tente de reprendre cette session,
  avec les contrôles workspace/Git habituels. Aucun prompt annulé n’est rejoué.
- Une réponse tardive de la requête annulée ne remplace pas la réponse d’une nouvelle
  requête et ne libère pas son verrou.

C’est un arrêt du processus demandé par Nexus, pas une interruption douce via
`turn/interrupt`. Il ne garantit pas l’arrêt de toutes les commandes enfants et
n’annule aucune modification de fichier. Vérifiez les commandes et fichiers avant
de continuer. La fermeture de la connexion peut précéder l’arrêt effectif du
processus. Un message dont l’envoi Telegram a déjà commencé ne peut pas être
rappelé par `/stop` ; son découpage déjà engagé peut encore terminer l’envoi.

La commande fonctionne aussi pour une requête lancée depuis les commandes locales
Nexus. Elle ne coupe pas le polling Telegram. L’association de session reste en
mémoire uniquement : elle disparaît au rechargement de l’extension.

## Tester soi-même

1. Arrêter l’ancienne session de débogage avec **Shift+F5**.
2. Dans le projet Nexus, lancer **Run Extension** avec **F5**. La compilation et la
   préparation sont automatiques : la fenêtre de développement ouvre
   `.nexus-dev/project`, son propre dépôt Git sur `nexus-test` au premier lancement.
   Aucun dossier à créer/choisir et aucune validation de confiance à effectuer.
   L’appairage Telegram existant est conservé. Sauvegarder les fichiers si vous les
   avez modifiés lors d’un précédent essai. Voir [le lancement F5](development.md).
3. Envoyer `/stop` avant toute requête : réponse « aucune requête », aucun lancement
   de Codex. Envoyer `/stop maintenant` : réponse `Usage : /stop`.
4. Envoyer `/codex Exécute sleep 30 puis réponds Terminé.` Dès que `/status` indique
   un turn en cours, envoyer `/stop`.
   Attendu : un message d’annulation, sans seconde erreur d’annulation ni réponse
   finale tardive. `/status` indique le processus arrêté, aucun turn et la session
   connue indisponible. Une commande `sleep` enfant peut subsister brièvement.
5. Noter l’identifiant de session, puis envoyer `/codex Réponds uniquement OK.`
   Attendu : réponse `OK`, même identifiant dans `/status`. Si Codex ne peut plus
   charger la session, Nexus signale l’erreur sans en créer une silencieusement.
6. Pour tester une approbation, envoyer :
   `/codex Exécute uniquement pwd en demandant explicitement une autorisation de sortie du sandbox avec sandbox_permissions=require_escalated.`
   Si les boutons apparaissent, envoyer `/stop` avant de répondre.
   Attendu : boutons retirés ou rendus inopérants ; `/status` affiche zéro approbation.
7. Envoyer deux fois `/stop` après l’arrêt : aucune nouvelle action, réponse « aucune
   requête ». `/status` reste utilisable.

Les tests automatisés simulent aussi un arrêt avant l’envoi du prompt, pendant
la validation du workspace et pendant la création de session, une reprise après
arrêt, les événements tardifs de l’ancien processus et les utilisateurs/chats non
autorisés. Ils ne contactent aucun bot réel.
