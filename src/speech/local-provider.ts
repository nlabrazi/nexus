import { ChildProcess, execFile } from 'node:child_process';
import { dirname, isAbsolute } from 'node:path';
import { SpeechError } from './errors';
import { SpeechAudio, SpeechToTextProvider, TranscriptionOptions } from './types';

export interface LocalSpeechConfiguration {
  pythonPath: string;
  modelPath: string;
  scriptPath: string;
}

/** One offline Python process per transcription; audio only travels through stdin. */
export class LocalSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private readonly configuration: LocalSpeechConfiguration) {
    if (!configuration.pythonPath.trim() || !configuration.modelPath.trim()) {
      throw new SpeechError('not_configured');
    }
    if (Object.values(configuration).some((value) => !isAbsolute(value) || value.includes('\0'))) {
      throw new SpeechError('invalid_configuration');
    }
  }

  async transcribe(audio: SpeechAudio, options: TranscriptionOptions): Promise<string> {
    if (options.signal.aborted) {
      throw new SpeechError('cancelled');
    }
    const { pythonPath, modelPath, scriptPath } = this.configuration;
    const args = ['-I', scriptPath, '--model', modelPath];
    if (options.language) {
      args.push('--language', options.language);
    }

    return new Promise<string>((resolve, reject) => {
      let child: ChildProcess | undefined;
      // execFile's AbortSignal path can use SIGTERM despite its killSignal option.
      // Stop the CPU worker explicitly, including while native inference is running.
      const onAbort = () => {
        child?.kill('SIGKILL');
      };
      try {
        child = execFile(
          pythonPath,
          args,
          {
            cwd: dirname(scriptPath),
            shell: false,
            windowsHide: true,
            killSignal: 'SIGKILL',
            encoding: 'utf8',
            maxBuffer: 1_000_000,
            env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
          },
          (error, stdout) => {
            options.signal.removeEventListener('abort', onAbort);
            if (options.signal.aborted) {
              reject(new SpeechError('cancelled'));
              return;
            }
            if (error) {
              const code = error.code;
              reject(
                new SpeechError(
                  code === 'ENOENT' || code === 'EACCES'
                    ? 'unavailable'
                    : code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                      ? 'invalid_response'
                      : 'transcription_failed'
                )
              );
              return;
            }
            try {
              const result: unknown = JSON.parse(stdout);
              if (!result || typeof result !== 'object' || Array.isArray(result)) {
                throw new SpeechError('invalid_response');
              }
              if ('error' in result) {
                switch (result.error) {
                  case 'not_configured':
                  case 'invalid_audio':
                  case 'audio_too_large':
                  case 'invalid_configuration':
                  case 'unavailable':
                  case 'transcription_failed':
                    throw new SpeechError(result.error);
                  default:
                    throw new SpeechError('invalid_response');
                }
              }
              if (!('text' in result) || typeof result.text !== 'string') {
                throw new SpeechError('invalid_response');
              }
              resolve(result.text);
            } catch (parseError) {
              reject(
                parseError instanceof SpeechError ? parseError : new SpeechError('invalid_response')
              );
            }
          }
        );
        // A process that fails before reading its input can close this pipe early.
        // execFile's callback remains responsible for reporting its exit/error.
        child.stdin?.on('error', () => {});
        options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.signal.aborted) {
          onAbort();
        } else {
          child.stdin?.end(audio.data);
        }
      } catch {
        options.signal.removeEventListener('abort', onAbort);
        child?.kill('SIGKILL');
        reject(new SpeechError('unavailable'));
      }
    });
  }
}
