# Audit — fiabilité, voix et interface

Périmètre de cette itération : logs, diagnostic, TTS et interface. Les fournisseurs
cloud et leur failover sont reportés à l’itération suivante. Aucun secret requis.

## Routage existant

```text
Telegram (extension) ───────────────────────┐
Telegram (Core) / UI Nuxt → Core → Desktop ├→ NexusRuntime
                                          ├→ ConversationalService → BrainModel
                                          │   → Ollama (ou Codex configuré)
                                          │   → CodingAgentTools, consentement conservé
                                          ├→ CodexService
                                          └→ AntigravityService
```

`NexusRuntime` partage les services entre extension et Desktop. Core assure le
routage, les présences, les approbations et l’API HTTP. Le Brain possède déjà son
contrat : aucune nouvelle abstraction de fournisseur n’est nécessaire.

## Logs et diagnostic

Les événements utilisent des `console` dispersés, sans rotation ni format commun.
Le Desktop journalise même un extrait du prompt ; les clients agents peuvent
imprimer stdout/stderr bruts. Ces contenus doivent sortir des logs de diagnostic.
`/status` expose déjà les sessions et quotas ; un diagnostic concis peut compléter
ce parcours sans supprimer les informations détaillées existantes.

## Voix

- Extension Telegram : worker Python Piper, modèle ONNX local Jessica, WAV en
  mémoire puis FFmpeg vers OGG/Opus, envoyé avec `sendVoice`. Il s’agit uniquement
  d’un acquittement fixe, pas de la lecture de la réponse complète.
- Le timeout commun de 30 s et le repli texte existent déjà. La validation audio
  est insuffisante (seulement le préfixe OggS), et les erreurs sont indifférenciées.
- Core expose la transcription, pas la synthèse ; son pont Telegram ne configure
  pas Piper. Il ne faut pas annoncer ce TTS comme disponible sur ce parcours.
- Web/Android : `speechSynthesis` du WebView/navigateur, indépendant de Piper.
  La lecture entière en une utterance, le chargement tardif des voix et les
  événements d’une ancienne lecture peuvent dégrader cette expérience. Les erreurs
  sont silencieuses. Le choix de voix et la vitesse ne sont pas configurables.

Le modèle et l’environnement Piper sont présents localement : un essai indépendant
du worker permettra de mesurer la latence et de contrôler le fichier produit.
La qualité perçue nécessite toujours une écoute humaine sur l’appareil cible.

## Interface

`web/app/app.vue` centralise conversation, connexion, modèles, voix et activité.
La conversation est déjà l’écran principal. Le HUD répète l’état, le projet et
des libellés techniques ; le modèle reste visible dans le composeur. Les réglages
et l’activité existent déjà comme vues secondaires et doivent le rester.
Le feedback d’envoi existe, mais les états ON/OFF/SYNC décrivent mal l’activité.

## Validation prévue

Chaque changement de comportement reçoit des tests ciblés : secrets et rotation,
diagnostic sans faux état connecté, audio invalide/timeout/annulation, nettoyage
vocal et remplacement d’une lecture. Exécuter compilation et suite unitaire à
chaque lot ; générer le client Nuxt après les changements UI. Préserver pairing,
contrôles workspace, sessions et approbations avec les tests existants.
