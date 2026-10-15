import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ClaudeCodeClientOptions, ClaudeCodeClientStatus, ClaudeStreamMessage } from './types';

export class ClaudeCodeClient {
  private readonly binaryPath: string;
  private currentProcess?: ChildProcessWithoutNullStreams;

  constructor(options: ClaudeCodeClientOptions = {}) {
    const defaultCandidates = [
      options.binaryPath,
      process.env.CLAUDE_PATH,
      '/home/kaox/.nvm/versions/node/v24.14.1/bin/claude',
      'claude',
    ].filter((p): p is string => Boolean(p));

    let resolved = 'claude';
    for (const candidate of defaultCandidates) {
      if (candidate === 'claude' || existsSync(candidate)) {
        resolved = candidate;
        break;
      }
    }
    this.binaryPath = resolved;
  }

  public getStatus(): ClaudeCodeClientStatus {
    return {
      available: true,
      binaryPath: this.binaryPath,
      version: '2.1.301',
    };
  }

  public async sendPrompt(
    prompt: string,
    workspacePath: string,
    onFilesChanged?: (paths: readonly string[]) => void,
    onChunk?: (delta: string) => void
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose'];

      const proc = spawn(this.binaryPath, args, {
        cwd: workspacePath,
        env: {
          ...process.env,
          CI: '1',
        },
      });

      this.currentProcess = proc;
      const filesModified = new Set<string>();
      let fullText = '';
      let resultText = '';
      let buffer = '';
      let isAuthError = false;

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as ClaudeStreamMessage;

            if (event.type === 'assistant' && event.message?.content) {
              for (const part of event.message.content) {
                if (part.type === 'text' && part.text) {
                  if (
                    part.text.includes('Not logged in') ||
                    part.text.includes('Please run /login')
                  ) {
                    isAuthError = true;
                  }
                  fullText += part.text;
                  onChunk?.(part.text);
                } else if (part.type === 'tool_use' && part.input) {
                  const pathCandidate =
                    (part.input.file_path as string) ||
                    (part.input.path as string) ||
                    (part.input.target_file as string);
                  if (pathCandidate) {
                    filesModified.add(pathCandidate);
                    onFilesChanged?.(Array.from(filesModified));
                  }
                }
              }
            }

            if (event.type === 'result' && event.result) {
              resultText = event.result;
            }

            if (event.error === 'authentication_failed' || isAuthError) {
              isAuthError = true;
            }
          } catch {
            // Ligne non JSON, ignorer
          }
        }
      });

      let stderrOutput = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString('utf8');
      });

      proc.on('error', (err) => {
        this.currentProcess = undefined;
        reject(
          new Error(`Impossible de lancer le CLI Claude Code (${this.binaryPath}) : ${err.message}`)
        );
      });

      proc.on('close', (code) => {
        this.currentProcess = undefined;
        if (isAuthError) {
          resolve(
            "🔒 Claude Code n'est pas authentifié.\n\n" +
              "Pour l'utiliser, connectez-vous dans un terminal avec :\n" +
              '  `claude login`\n' +
              "ou définissez la variable d'environnement `ANTHROPIC_API_KEY`."
          );
          return;
        }

        if (code !== 0 && !resultText && !fullText) {
          reject(
            new Error(`Claude Code a échoué (code ${code}) : ${stderrOutput || 'Erreur inconnue'}`)
          );
          return;
        }

        resolve(resultText || fullText || '(Tâche terminée sans réponse textuelle)');
      });
    });
  }

  public cancel(): boolean {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGINT');
      this.currentProcess = undefined;
      return true;
    }
    return false;
  }
}
