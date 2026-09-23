import { execFile } from 'node:child_process';

/** Synthesizes a short, deliberately generic acknowledgement without interpreting the prompt. */
export async function synthesizeAcknowledgement(signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const wave = await runAudioProcess(
    'espeak-ng',
    ['-v', 'fr', '-s', '155', '--stdout', 'Bien compris. Je prends en charge votre demande.'],
    boundedSignal
  );
  try {
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
    if (ogg.subarray(0, 4).toString() !== 'OggS') {
      throw new Error('Speech synthesis unavailable');
    }
    return ogg;
  } finally {
    wave.fill(0);
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
          reject(new Error('Speech synthesis unavailable'));
        } else {
          resolve(stdout);
        }
      }
    );
    const abort = () => {
      child.kill('SIGKILL');
      reject(new Error('Speech synthesis cancelled'));
    };
    child.stdin?.on('error', () => {});
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else child.stdin?.end(input);
  });
}
