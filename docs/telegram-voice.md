# Messages vocaux Telegram

Nexus détecte les messages `message.voice` du compte appairé dans sa conversation
privée, télécharge leur audio depuis Telegram, le transcrit localement, puis
transmet automatiquement le texte reconnu à l'agent actif (**Codex** ou **Gemini Antigravity**).
Aucun préfixe `/codex` ou
`/agy` n’est nécessaire pour envoyer un vocal avec le microphone Telegram.

Les messages suivants accompagnent le traitement :

> ⏳ Téléchargement du message vocal…

> ⏳ Transcription locale du message vocal…

> 🎙 Transcription :
>
> Le texte reconnu dans votre vocal.

> ⏳ Codex is working… *(ou ⏳ Gemini Antigravity is working…)*

> *(Réponse finale de l'agent)*

Le [service de transcription locale](speech-local.md) utilise les mêmes paramètres
`nexus.speech.pythonPath`, `nexus.speech.modelPath` et `nexus.speech.language` que
le test VS Code. Les réglages sont relus à chaque vocal ; ils doivent être définis
sur la machine où Nexus tourne. Le workspace doit être approuvé dans VS Code.
Le texte reconnu est transmis comme prompt à l'agent actif avec la session, le modèle
et le workspace en cours.

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
- L’audio reste en mémoire ; aucun fichier temporaire n’est écrit. Le buffer
  téléchargé est effacé à la fin du traitement, y compris en cas d’échec ou
  d’annulation. Le format reste celui reçu,
  sans conversion, avec le nom fourni par Telegram et le MIME type du vocal.
- Les erreurs affichées ne contiennent ni le token du bot ni l’URL de téléchargement.

## Transcription

Le moteur Python local dispose de **120 secondes maximum**, chargement du modèle
compris, après le téléchargement. Il n’utilise aucune API de transcription distante.
Le texte reconnu est ensuite envoyé dans votre conversation Telegram appairée.
Les transcriptions longues sont découpées en plusieurs messages en texte brut.

Un silence, un modèle indisponible ou une configuration manquante produit un
message d’erreur explicite. Corriger les paramètres dans VS Code si nécessaire,
puis envoyer un nouveau vocal pour réessayer.

## Annulation et concurrence

Le polling reste actif pendant le téléchargement, la transcription et l'exécution de l'agent :
`/ping`, `/status`, `/stop` et les boutons Telegram continuent à fonctionner.
Une autre demande de vocal ou de prompt est refusée pendant l’opération ; elle n’est pas mise en attente.

- Si `/stop` intervient pendant le téléchargement ou la transcription locale, l'opération vocale
  est annulée et Nexus répond : « ⏹ Traitement du message vocal annulé. ».
- Si `/stop` intervient pendant l'exécution du prompt par l'agent actif, l'arrêt de l'agent
  est déclenché et Nexus répond avec le message d'annulation habituel.
- L’arrêt de l’extension et un nouvel appairage annulent le traitement en cours.
Un message déjà reçu par Telegram ne peut pas être rappelé par cette annulation.
Un résultat arrivé après annulation est ignoré. Un nouvel envoi explicite permet
de réessayer après une erreur ou une annulation.

## Vérification

Les tests de `src/test/unit/telegram-voice.unit.ts`,
`src/test/unit/telegram-voice-download.unit.ts` et
`src/test/unit/telegram-voice-transcription.unit.ts` couvrent les autorisations,
le transport HTTP, les limites, la transcription, l'envoi du prompt à l'agent actif,
les erreurs, l’annulation et les réponses tardives.
Ils utilisent des transports simulés et ne contactent aucun bot réel.

```sh
npm run test:unit
npm run compile
```

1. Relancer Nexus avec F5 en suivant le [guide de développement](development.md) :
   une seule instance doit utiliser le bot. `/status` doit indiquer le workspace
   `project` et le chemin `.nexus-dev/project`.
2. Envoyer un vocal au bot avec le microphone Telegram, depuis le compte appairé.
3. Vérifier le message de téléchargement, puis celui de transcription locale,
   puis « 🎙 Transcription : » suivi des paroles reconnues, puis l'indicateur de travail
   de l'agent (« ⏳ Codex is working... » ou « ⏳ Gemini Antigravity is working... »),
   et enfin la réponse finale de l'agent.
4. Envoyer `/ping` : le bot doit répondre `pong`.
5. Si l'opération est encore en cours, envoyer `/stop` pour vérifier l'annulation sans résultat tardif.
