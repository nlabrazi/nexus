import { logger } from '../logging/logger';
import { isPcmWave, isOggOpus } from './audio-validation';
import { SpeechSynthesisError } from './synthesis-error';
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';

export interface AcknowledgementConfiguration {
  pythonPath: string;
  modelPath: string;
  scriptPath: string;
  speakerId: number;
  timeoutMs?: number;
}

/** Synthesizes a short, deliberately generic acknowledgement without interpreting the prompt. */
export async function synthesizeAcknowledgement(
  signal: AbortSignal,
  configuration: AcknowledgementConfiguration
): Promise<Buffer> {
  signal.throwIfAborted();
  const { pythonPath, modelPath, scriptPath, speakerId } = configuration;
  if (
    [pythonPath, modelPath, scriptPath].some((path) => !isAbsolute(path) || path.includes('\0')) ||
    !Number.isSafeInteger(speakerId) ||
    speakerId < 0 ||
    (configuration.timeoutMs !== undefined &&
      (!Number.isSafeInteger(configuration.timeoutMs) ||
        configuration.timeoutMs <= 0 ||
        configuration.timeoutMs > 30_000))
  ) {
    throw new SpeechSynthesisError('invalid_configuration');
  }
  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(configuration.timeoutMs ?? 30_000);
  const boundedSignal = AbortSignal.any([signal, timeout]);
  try {
    const wave = await runAudioProcess(
      pythonPath,
      ['-I', scriptPath, '--model', modelPath, '--speaker', String(speakerId)],
      boundedSignal,
      Buffer.from('Bien compris. Je prends en charge votre demande.', 'utf8')
    );
    try {
      if (!isPcmWave(wave)) throw new SpeechSynthesisError('invalid_audio');
      const ogg = await runAudioProcess(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-c:a',
          'libopus',
          '-b:a',
          '32k',
          '-f',
          'ogg',
          'pipe:1',
        ],
        boundedSignal,
        wave
      );
      if (!isOggOpus(ogg)) {
        ogg.fill(0);
        throw new SpeechSynthesisError('invalid_audio');
      }
      logger.info('TTS', 'synthesize', {
        provider: 'piper',
        status: 'success',
        durationMs: Date.now() - startedAt,
      });
      return ogg;
    } finally {
      wave.fill(0);
    }
  } catch (error) {
    const failure = signal.aborted
      ? new SpeechSynthesisError('cancelled')
      : timeout.aborted
        ? new SpeechSynthesisError('timeout')
        : error;
    logger.warn(
      'TTS',
      'synthesize',
      {
        provider: 'piper',
        status: signal.aborted ? 'cancelled' : 'text_fallback',
        durationMs: Date.now() - startedAt,
      },
      failure
    );
    throw failure;
  }
}

function runAudioProcess(
  executable: string,
  args: string[],
  signal: AbortSignal,
  input?: Buffer
): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      args,
      {
        shell: false,
        windowsHide: true,
        encoding: 'buffer',
        maxBuffer: 2_000_000,
        killSignal: 'SIGKILL',
      },
      (error, stdout) => {
        signal.removeEventListener('abort', abort);
        if (error || signal.aborted || !stdout.length) {
          stdout.fill(0);
          reject(
            new SpeechSynthesisError(
              signal.aborted ? 'cancelled' : error ? 'process_failed' : 'invalid_audio'
            )
          );
        } else {
          resolve(stdout);
        }
      }
    );
    const abort = () => {
      child.kill('SIGKILL');
      signal.removeEventListener('abort', abort);
      reject(new SpeechSynthesisError('cancelled'));
    };
    child.stdin?.on('error', () => {});
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else child.stdin?.end(input);
  });
}
