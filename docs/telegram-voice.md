# Messages vocaux Telegram

Nexus détecte les messages `message.voice` du compte appairé dans sa conversation
privée, puis télécharge leur audio depuis Telegram. Aucun préfixe `/codex` ou
`/agy` n’est nécessaire pour envoyer un vocal avec le microphone Telegram.

Deux messages accompagnent la réception :

> ⏳ Téléchargement du message vocal…

> 🎙 Message vocal téléchargé. La transcription n’est pas encore disponible. Utilisez `/codex <instruction>` pour envoyer votre demande par écrit.

La transcription et l’envoi à un agent viendront dans les étapes suivantes.
Aucun prompt n’est envoyé à Codex ou Antigravity à cette étape.

## Téléchargement

- Les contrôles d’utilisateur et de conversation précèdent tout téléchargement.
- Nexus appelle `getFile` avec le `file_id` du vocal, puis télécharge le chemin
  retourné. Un nouveau chemin est demandé à chaque téléchargement : les liens
  Telegram expirent. Voir la [Bot API Telegram](https://core.telegram.org/bots/api#getfile).
- La limite Nexus est de **20 Mo (20 000 000 octets)**. Elle est vérifiée sur les
  métadonnées disponibles, le `Content-Length` et les octets effectivement lus,
  même si les tailles annoncées sont absentes ou sous-estimées.
- La résolution du fichier et la lecture de son contenu disposent ensemble de
  **30 secondes maximum** ; l’appel `getFile` garde aussi le timeout HTTP de
  15 secondes du client Telegram.
- L’audio reste en mémoire ; aucun fichier temporaire n’est écrit. À cette étape,
  le buffer final est effacé après téléchargement. Le format reste celui reçu,
  sans conversion, avec le nom fourni par Telegram et le MIME type du vocal.
- Les erreurs affichées ne contiennent ni le token du bot ni l’URL de téléchargement.

## Annulation et concurrence

Le polling reste actif pendant le téléchargement : `/ping`, `/status`, `/stop`
et les boutons Telegram continuent à fonctionner. Une autre demande de vocal ou
de prompt est refusée pendant l’opération ; elle n’est pas mise en attente.

`/stop`, l’arrêt de l’extension et un nouvel appairage annulent le téléchargement.
Un résultat arrivé après annulation est ignoré. Un nouvel envoi explicite permet
de réessayer après une erreur ou une annulation.

## Vérification

Les tests de `src/test/unit/telegram-voice.unit.ts` et
`src/test/unit/telegram-voice-download.unit.ts` couvrent les autorisations, le
transport HTTP, les limites, les erreurs, l’annulation et les réponses tardives.
Ils utilisent des transports simulés et ne contactent aucun bot réel.

```sh
npm run test:unit
npm run compile
```

1. Relancer Nexus avec F5 en suivant le [guide de développement](development.md) :
   une seule instance doit utiliser le bot. `/status` doit indiquer le workspace
   `project` et le chemin `.nexus-dev/project`.
2. Envoyer un vocal au bot avec le microphone Telegram, depuis le compte appairé.
3. Vérifier le message de téléchargement, puis « Message vocal téléchargé ».
4. Envoyer `/ping` : le bot doit répondre `pong`.
5. Si un téléchargement est encore en cours, envoyer `/stop` : Nexus doit répondre
   « Téléchargement du message vocal annulé », sans confirmation de réussite tardive.
