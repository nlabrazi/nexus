# Messages vocaux Telegram

La première étape prend en charge la détection des messages `message.voice`.
Nexus répond au compte appairé, dans sa conversation privée :

> 🎙 Message vocal reçu. La transcription n’est pas encore disponible. Utilisez `/codex <instruction>` pour envoyer votre demande par écrit.

Les vocaux des autres utilisateurs ou conversations sont ignorés. Aucun audio
n’est téléchargé et aucun prompt n’est envoyé à Codex ou Antigravity à cette étape.
Les commandes texte restent disponibles.

Le téléchargement et la transcription seront ajoutés dans les étapes suivantes.
Le type `TelegramVoice` conserve les identifiants du fichier, sa durée et les
métadonnées facultatives (`mime_type`, `file_size`) décrits par la
[Bot API Telegram](https://core.telegram.org/bots/api#voice).

## Vérification

Les tests de `src/test/unit/telegram-voice.unit.ts` couvrent la réception avec ou
sans métadonnées facultatives, le filtrage des expéditeurs/conversations,
l’absence d’appel aux agents, les doublons et la poursuite des commandes texte.

```sh
npm run test:unit
npm run compile
```

Pour vérifier dans Telegram, lancer Nexus avec F5, puis envoyer un message vocal
au bot depuis le compte appairé. L’accusé de réception doit apparaître. Envoyer
ensuite `/ping` : le bot doit répondre `pong`.
