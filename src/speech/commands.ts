import * as vscode from 'vscode';
import { basename } from 'node:path';
import { SpeechError } from './errors';
import { createConfiguredSpeechService } from './configuration';
import { SPEECH_MAX_AUDIO_BYTES } from './service';

export function registerSpeechTestCommand(context: vscode.ExtensionContext): vscode.Disposable {
  let active: AbortController | undefined;
  const command = vscode.commands.registerCommand('nexus.testSpeechToText', async () => {
    if (active) {
      void vscode.window.showWarningMessage('Nexus: Un test de transcription est déjà en cours.');
      return;
    }
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage('Nexus: Faites confiance au workspace pour lancer le moteur vocal local.');
      return;
    }
    const controller = new AbortController();
    active = controller;
    let data: Uint8Array | undefined;
    try {
      const config = vscode.workspace.getConfiguration('nexus.speech');
      const pythonPath = config.get<string>('pythonPath', '');
      const modelPath = config.get<string>('modelPath', '');
      if (!pythonPath.trim() || !modelPath.trim()) {
        void vscode.window.showWarningMessage(
          'Nexus: Configurez nexus.speech.pythonPath et nexus.speech.modelPath avant le test de transcription locale.'
        );
        return;
      }
      const { service, language } = createConfiguredSpeechService(context);
      const selected = await vscode.window.showOpenDialog({
        canSelectMany: false, canSelectFolders: false,
        title: 'Nexus : choisir un audio à transcrire localement',
        filters: { Audio: ['ogg', 'oga', 'opus', 'wav', 'mp3', 'm4a', 'flac', 'webm'] },
      });
      const uri = selected?.[0];
      if (!uri || controller.signal.aborted) { return; }
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Nexus : transcription locale…', cancellable: true,
      }, async (_progress, token) => {
        const cancellation = token.onCancellationRequested(() => controller.abort());
        if (token.isCancellationRequested) { controller.abort(); }
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > SPEECH_MAX_AUDIO_BYTES) { throw new SpeechError('audio_too_large'); }
          if (controller.signal.aborted) { return; }
          data = await vscode.workspace.fs.readFile(uri);
          if (!vscode.workspace.isTrusted) { throw new SpeechError('cancelled'); }
          const text = await service.transcribe({ data, fileName: basename(uri.path) }, {
            signal: controller.signal, language,
          });
          if (controller.signal.aborted) { return; }
          const document = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
          if (!controller.signal.aborted) { await vscode.window.showTextDocument(document); }
        } finally {
          cancellation.dispose();
        }
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof SpeechError && error.code === 'cancelled')) { return; }
      const message = error instanceof SpeechError ? error.message : 'Impossible de lire le fichier audio.';
      void vscode.window.showErrorMessage(`Nexus: ${message}`);
    } finally {
      data?.fill(0);
      if (active === controller) { active = undefined; }
    }
  });
  return vscode.Disposable.from(command, { dispose: () => active?.abort() });
}
