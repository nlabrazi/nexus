import { DiagnosticError } from '../logging/logger';

export class SpeechSynthesisError extends DiagnosticError {
  constructor(
    readonly code:
      | 'invalid_configuration'
      | 'process_failed'
      | 'invalid_audio'
      | 'timeout'
      | 'cancelled'
  ) {
    super(
      {
        invalid_configuration:
          'Configure nexus.speech.tts with local Piper paths and a valid speaker ID',
        process_failed: 'Speech synthesis process unavailable',
        invalid_audio: 'Speech synthesis produced invalid audio',
        timeout: 'Speech synthesis timed out',
        cancelled: 'Speech synthesis cancelled',
      }[code]
    );
    this.name = 'SpeechSynthesisError';
  }
}
