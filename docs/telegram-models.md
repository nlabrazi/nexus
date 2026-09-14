# Choisir le modèle : /model

Envoyer `/model` depuis le compte Telegram appairé, en conversation privée.

1. Nexus demande le catalogue au processus Codex installé. Il peut démarrer ce processus, mais ne crée aucune session et n’envoie aucun prompt.
2. Le menu affiche six modèles par page. Les boutons **Précédents** et **Suivants** permettent de parcourir toute la liste. `✓` indique le modèle sélectionné ; `☆` le modèle par défaut du catalogue.
3. Appuyer sur un modèle, puis sur un effort de raisonnement parmi ceux annoncés par Codex. Le bouton **Modèles** revient au catalogue ; **Annuler** ferme le menu sans changer le choix.
4. Nexus confirme le modèle et l’effort. Ils seront appliqués à la prochaine demande `/codex`, ainsi qu’aux prochaines créations/reprises explicites de session.

La préférence est sauvegardée dans le stockage du workspace VS Code, indépendamment de la conversation sélectionnée. Elle survit au rechargement de l’extension. Le fichier global `~/.codex/config.toml` n’est pas modifié. Avant un choix explicite, Nexus utilise les paramètres fournis par Codex.

La liste n’est pas codée en dur : Nexus parcourt les pages de `model/list` et masque les entrées `hidden`. Un modèle peut disparaître du catalogue entre l’ouverture et la sélection ; le choix est donc vérifié de nouveau au clic final. Les erreurs de catalogue ou de stockage sont affichées, sans remplacement silencieux par un autre modèle.

## Validité des boutons

- Les menus expirent après deux minutes. Relancer `/model` ferme le précédent.
- Les boutons sont associés à un identifiant aléatoire, au compte, au chat privé et au message. Un double clic ne sélectionne qu’une fois.
- `/new`, `/resume`, `/switch`, `/stop`, un nouvel appairage et l’arrêt de Telegram ferment le menu. Une session ou un workspace différent rend le contexte de sélection invalide.
- Le choix final est refusé pendant un prompt, une opération de session, un changement de branche ou une autre sauvegarde de modèle. Aucun choix n’est mis en attente pour être appliqué sans nouveau clic.
- La consultation du catalogue laisse le polling fonctionner : `/status`, `/help`, `/stop` et les approbations restent accessibles.
- `/stop` concerne les requêtes Codex. Il ne révoque pas un choix déjà confirmé ni une écriture de préférence déjà engagée par le clic final.

## Statut

`/status` distingue le **modèle de la session**, confirmé par Codex, du **choix pour le prochain prompt**. Sélectionner un modèle n’envoie pas un prompt vide pour forcer un changement. Les compteurs existants restent ceux de la conversation ; un changement de modèle ne les remet pas à zéro.

## Vérifier

```sh
npm run test:unit
npm run compile
```

Les tests couvrent les catalogues paginés, les réponses invalides, les efforts non pris en charge, les préférences persistées, les refus pendant une opération, les menus périmés, les doubles clics, l’authentification des boutons, les erreurs de transport et les paramètres envoyés à `thread/start`, `thread/resume` et `turn/start`.

Pour un essai manuel : relancer l’Extension Development Host, envoyer `/model`, choisir un modèle et un effort, puis `/status`. Envoyer un prompt court et consulter `/status` après la réponse pour vérifier le modèle appliqué et les tokens. Relancer l’extension et vérifier que le choix est conservé. Les tests automatisés utilisent des transports simulés et ne contactent aucun compte ni bot réel.

Contrat vérifié avec les types générés par `codex-cli 0.154.0` et la [documentation officielle App Server](https://developers.openai.com/codex/app-server/).
