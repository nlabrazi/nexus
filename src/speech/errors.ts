export type SpeechErrorCode = 'not_configured' | 'invalid_audio' | 'audio_too_large' |
  'invalid_configuration' | 'unavailable' | 'invalid_response' | 'empty_transcript' |
  'timeout' | 'cancelled' | 'transcription_failed';

const messages: Record<SpeechErrorCode, string> = {
  not_configured: 'Le service de transcription n’est pas configuré.',
  invalid_audio: 'Le fichier audio est invalide ou vide.',
  audio_too_large: 'Le fichier audio dépasse la limite de 20 Mo.',
  invalid_configuration: 'La configuration du service de transcription est invalide.',
  unavailable: 'Le service de transcription est indisponible. Vérifiez sa configuration.',
  invalid_response: 'Le service de transcription a renvoyé une réponse invalide.',
  empty_transcript: 'Aucune parole n’a été reconnue dans ce message vocal.',
  timeout: 'Le délai maximal de transcription a été dépassé. Réessayez avec un vocal plus court.',
  cancelled: 'Transcription annulée.',
  transcription_failed: 'La transcription du message vocal a échoué. Réessayez.',
};

export class SpeechError extends Error {
  constructor(readonly code: SpeechErrorCode) {
    super(messages[code]);
    this.name = 'SpeechError';
  }
}
