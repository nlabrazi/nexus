import * as vscode from 'vscode';
import { SpeechError } from './errors';
import { LocalSpeechToTextProvider } from './local-provider';
import { SpeechToTextService } from './service';

/** Read current machine settings for each request, shared by local and Telegram tests. */
export function createConfiguredSpeechService(context: vscode.ExtensionContext) {
  if (!vscode.workspace.isTrusted) {
    throw new SpeechError('untrusted_workspace');
  }
  const config = vscode.workspace.getConfiguration('nexus.speech');
  const service = new SpeechToTextService(
    new LocalSpeechToTextProvider({
      pythonPath: config.get<string>('pythonPath', ''),
      modelPath: config.get<string>('modelPath', ''),
      scriptPath: context.asAbsolutePath('runtime/speech/transcribe.py'),
    })
  );
  return { service, language: config.get<string>('language', '').trim() || undefined };
}
