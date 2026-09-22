export interface SpeechAudio {
  data: Uint8Array;
  fileName: string;
  mimeType?: string;
}

export interface TranscriptionOptions {
  signal: AbortSignal;
  language?: string;
}

export interface SpeechToTextProvider {
  transcribe(audio: SpeechAudio, options: TranscriptionOptions): Promise<string>;
}
