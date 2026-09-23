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
