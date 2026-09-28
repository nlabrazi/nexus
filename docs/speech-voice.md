# Acquittement vocal avec Jessica

Nexus utilise [Piper](https://github.com/OHF-Voice/piper1-gpl) pour prononcer
« Bien compris. Je prends en charge votre demande. » après la transcription
d'un vocal Telegram et avant de lancer l'agent. Le modèle est **fr_FR-upmc-medium**,
avec **speaker 0 = Jessica** (**1 = Pierre**), comme dans les
[exemples Piper](https://rhasspy.github.io/piper-samples/).

## Installation Ubuntu / WSL

Depuis le dossier Nexus, sur la machine où l'extension s'exécute :

```sh
sudo apt install python3-venv ffmpeg
python3 -m venv .nexus-speech/piper
.nexus-speech/piper/bin/python -m pip install -r runtime/speech/requirements-tts.txt
.nexus-speech/piper/bin/python -m piper.download_voices fr_FR-upmc-medium --data-dir .nexus-speech/voices
```

Si Piper est déjà installé dans cet environnement, exécuter à nouveau la commande
pip pour utiliser la version testée. Les dépendances sont séparées de celles de
faster-whisper ; la transcription existante conserve ses paramètres.
Le modèle `.onnx` et sa configuration `.onnx.json` sont téléchargés ensemble.
Les fichiers `.nexus-speech/` sont ignorés par Git et exclus du VSIX.

## Paramètres VS Code

Définir les paramètres **Utilisateur**, ou **Distant** dans WSL/SSH :

```json
{
  "nexus.speech.tts.pythonPath": "/chemin/vers/nexus/.nexus-speech/piper/bin/python",
  "nexus.speech.tts.modelPath": "/chemin/vers/nexus/.nexus-speech/voices/fr_FR-upmc-medium.onnx",
  "nexus.speech.tts.speakerId": 0
}
```

Remplacer `/chemin/vers/nexus` par le chemin absolu du dépôt (`pwd` dans son terminal).
`modelPath` désigne le **fichier ONNX**, pas le dossier. Ces chemins sont propres
à la machine : une extension installée en VSIX utilise les mêmes paramètres,
quel que soit le projet ouvert dans VS Code. Les réglages sont relus à chaque vocal.
Un workspace approuvé est nécessaire.

## Essai

Pour écouter Jessica avant de lancer Nexus :

```sh
.nexus-speech/piper/bin/python -m piper -m fr_FR-upmc-medium \
  --data-dir .nexus-speech/voices --speaker 0 \
  -f .nexus-speech/test-jessica.wav \
  -- "Bien compris. Je prends en charge votre demande."
ffplay -nodisp -autoexit .nexus-speech/test-jessica.wav
```

Recompiler puis relancer avec F5, ou reconstruire et installer le VSIX selon
le [guide de packaging](../README.md#-private-packaging--installation).
Envoyer un vocal au bot : l'acquittement écrit, la voix de Jessica et la réponse
de l'agent doivent arriver dans cet ordre. Une seule instance de Nexus doit
utiliser le bot Telegram.

Piper charge uniquement les fichiers locaux sur CPU. Le petit worker Python
`runtime/speech/synthesize.py` est inclus dans l'extension ; le modèle et son
environnement Python restent externes. Le texte passe par stdin et l'audio WAV
reste en mémoire avant conversion OGG/Opus avec FFmpeg. La synthèse et la conversion
ont une limite commune de 30 secondes. `/stop` interrompt aussi cette étape.

Si aucun vocal d'acquittement n'arrive, vérifier l'essai ci-dessus, les chemins
absolus dans les paramètres du bon hôte et la présence de FFmpeg dans le PATH.
Si le modèle ou Piper est indisponible, Nexus conserve l'acquittement écrit et
exécute la demande. Il ne revient pas à la voix robotique d'eSpeak.

## Vérification

```sh
npm run test:unit
npm run compile
```

Les tests couvrent le passage du texte et du speaker au worker, l'annulation,
les réglages invalides, l'envoi Telegram et le repli écrit. L'essai manuel avec
le modèle téléchargé valide la synthèse réelle ; les tests unitaires restent
indépendants de Piper et du modèle.

## Réglages et lecture dans le client web

Dans VS Code, `nexus.speech.tts.enabled` active ou coupe l’acquittement Piper.
`nexus.speech.tts.speed` règle la vitesse entre 0,8 et 1,3 (défaut : 1).
`modelPath` choisit le modèle de voix et `speakerId` son locuteur. Ces paramètres
sont relus à chaque demande ; couper la voix conserve l’acquittement écrit.

Dans le client web, **Connexion & préférences → Voix** permet d’activer la voix,
de choisir une voix installée, sa vitesse et la lecture automatique. Le menu
rapide fournit aussi l’interrupteur voix. Avec la lecture automatique coupée,
le bouton d’un message permet toujours une écoute manuelle. Les choix sont
mémorisés sur cet appareil. **Écouter un exemple** permet de valider le moteur.

La lecture web utilise le moteur du navigateur, et non Piper : sa disponibilité
et ses voix dépendent de l’appareil/WebView. Un échec de lecture affiche un court
message et laisse la réponse texte intacte. Le navigateur peut exiger une action
utilisateur avant la première lecture automatique ; utiliser le bouton d’écoute.
Les blocs de code, tableaux et URL sont omis à l’oral ; les réponses longues sont
lues par phrases, dans une limite de 6 000 caractères. Les événements tardifs d’une
ancienne lecture ne peuvent plus interrompre la lecture actuelle.

Les tests du contrôleur web s’exécutent avec `npm --prefix web run test:unit`.
La qualité perçue et la lecture Android restent à vérifier sur l’appareil cible.

## Réponse vocale dans l’application Android

L’APK utilise le moteur TTS Android via `@capacitor-community/text-to-speech`.
Le navigateur conserve son moteur Web Speech. La version précédente utilisait
uniquement Web Speech, qui ne fournit pas de moteur exploitable dans certaines
WebView Android : une dictée pouvait fonctionner sans aucune réponse audible.

Avec « Activer la voix », une demande dictée reçoit désormais la réponse finale
à voix haute, même si « Lire aussi les réponses aux messages écrits » est désactivé.
Cela fonctionne également quand la dictée est relue puis envoyée manuellement.
Désactiver la voix coupe toute lecture. Le micro arrête la lecture en cours.
Le choix de voix, la vitesse, le nettoyage du Markdown et l’arrêt manuel restent
pris en charge. Une erreur audio conserve la réponse textuelle et affiche un message.

Il faut **installer la nouvelle APK** (`npm run android:build`, puis
`nexus-debug.apk`) : une mise à jour du serveur seule n’ajoute pas le plugin natif.
Sur le téléphone, vérifier qu’un moteur de synthèse vocale et une voix française
sont installés dans les paramètres Android, puis utiliser « Écouter un exemple »
dans les préférences Nexus. Aucune clé API cloud n’est nécessaire pour ce TTS.
Une voix Android marquée locale est préférée automatiquement.

Validation : tests du contrôleur natif simulé (fin de lecture, segments successifs,
annulation, remplacement, voix manquante, erreur et délai), tests de la politique
« dictée → réponse vocale » et compilation de l’APK. L’écoute et la reconnaissance
sur un téléphone physique restent à vérifier après installation.

Le parcours complet de dictée est aussi testé avec un pont Android simulé :
`node scripts/test-android-voice.cjs` après `npm run web:build`.
