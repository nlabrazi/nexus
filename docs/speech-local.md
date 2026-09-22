# Transcription locale

Cette étape ajoute le moteur de transcription et un test depuis VS Code. Le
branchement aux messages vocaux Telegram sera effectué à l’étape suivante :
Telegram confirme encore uniquement leur téléchargement.

Nexus lance [faster-whisper](https://github.com/SYSTRAN/faster-whisper) dans un
processus Python local, avec le modèle multilingue `small`, sur CPU en `int8`.
Le moteur reçoit l’audio en mémoire et renvoie le texte. Aucun service de
transcription distant ni clé API n’est nécessaire.

## Installation initiale (Linux / WSL)

Dans le dépôt Nexus, avec Python 3.10 ou ultérieur et le module `venv` :

```sh
python3 -m venv .nexus-speech/venv
.nexus-speech/venv/bin/python -m pip install -r runtime/speech/requirements.txt
.nexus-speech/venv/bin/python scripts/download-speech-model.py --output .nexus-speech/models/small
```

Ces commandes téléchargent les dépendances depuis PyPI et le modèle depuis
Hugging Face. Prévoir environ 500 Mo pour le modèle, en plus des dépendances.
La transcription elle-même est hors ligne : elle charge exclusivement les
fichiers locaux. Le dossier `.nexus-speech/` est exclu de Git et du VSIX.

L’installation doit se trouver dans l’environnement où l’extension s’exécute :
dans WSL si VS Code est connecté à WSL, ou sur l’hôte SSH en développement distant.
Le modèle et Python restent externes au paquet de l’extension ; le petit script
`runtime/speech/transcribe.py`, lui, est inclus dans le VSIX.

## Configuration

Ouvrir les paramètres **Utilisateur** de VS Code, ou les paramètres **Distant**
dans une fenêtre WSL/SSH, et définir les chemins absolus :

```json
{
  "nexus.speech.pythonPath": "/chemin/vers/nexus/.nexus-speech/venv/bin/python",
  "nexus.speech.modelPath": "/chemin/vers/nexus/.nexus-speech/models/small",
  "nexus.speech.language": "fr"
}
```

Adapter `/chemin/vers/nexus` au chemin du dépôt. Ces réglages sont propres à la
machine ; ne pas les placer dans les paramètres du projet de test. Une langue
vide active la détection automatique. `fr` force le français et `en` l’anglais.
Utiliser un code de langue pris en charge par le modèle.

## Test manuel

1. Lancer Nexus avec F5 en suivant le [guide de développement](development.md).
2. Dans la fenêtre **Extension Development Host**, ouvrir la palette de commandes.
3. Exécuter **Nexus: Test Local Speech-to-Text**.
4. Choisir un fichier audio court, par exemple un vocal Telegram enregistré en
   `.oga` ou `.ogg`. WAV, MP3, M4A, FLAC, Opus et WebM sont aussi proposés.
5. La transcription apparaît dans un nouvel éditeur texte non enregistré.
   Elle n’est pas envoyée à un agent ni à Telegram.

Le modèle est chargé à chaque test et libéré avec le processus. Le premier
résultat peut donc prendre quelques secondes. Un seul test peut s’exécuter à la
fois. **Annuler** interrompt le processus ; l’arrêt de l’extension l’annule aussi.
Un workspace approuvé est nécessaire pour exécuter Python.

La limite est de **20 Mo** et le délai de transcription de **120 secondes**,
chargement du modèle compris. Un silence donne une erreur « Aucune parole n’a
été reconnue ». Si le moteur est indisponible, vérifier le Python configuré,
l’installation de faster-whisper et le dossier du modèle. Si le modèle est
absent ou incomplet, relancer la commande de téléchargement initial.

## Vérification automatisée

```sh
npm run test:unit
python3 -B -m unittest discover -s scripts -p 'test_speech_worker.py'
npm run compile
```

Les tests TypeScript couvrent la validation, les erreurs, les limites, le
transport binaire et l’annulation. Les tests Python utilisent un modèle simulé
pour vérifier le chargement local, le décodage et la consommation des segments
de transcription. Ils ne nécessitent ni modèle téléchargé ni dépendances Python
supplémentaires. Le test manuel vérifie, lui, la reconnaissance réelle de la voix.
