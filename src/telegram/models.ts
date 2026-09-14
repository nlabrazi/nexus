import { randomBytes } from 'crypto';
import { CodexModel, ModelControls, ModelMenu } from '../codex/types';
import { TelegramPeer } from './approvals';
import { TelegramClient } from './client';
import { TelegramCallbackQuery, TelegramInlineKeyboard } from './types';

interface Menu {
  token: string;
  peer: TelegramPeer;
  data: ModelMenu;
  page: number;
  model?: CodexModel;
  messageId?: number;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  busy: boolean;
}
const PAGE_SIZE = 6;

export class TelegramModels {
  private menu?: Menu;
  private generation = 0;
  private opening = false;

  constructor(
    private readonly client: TelegramClient,
    private readonly peer: () => TelegramPeer | undefined,
    private readonly controls?: ModelControls,
    private readonly isBusy: () => boolean = () => false,
    private readonly agentName: string = 'Codex',
    private readonly promptCommand: string = 'codex'
  ) { }

  hasActiveMenu(): boolean {
    return this.menu !== undefined;
  }

  async open(): Promise<void> {
    const peer = this.peer();
    if (!peer) { return; }
    if (this.opening) {
      await this.client.sendMessage(peer.chatId, 'La liste des modèles est en cours de chargement.')
        .catch(() => console.warn('[Telegram] Model loading notice failed.'));
      return;
    }
    this.opening = true;
    this.cancel();
    const generation = this.generation;
    try {
      if (!this.controls) { throw new Error('La sélection des modèles est indisponible.'); }
      const data = await this.controls.list();
      if (generation !== this.generation || !this.samePeer(peer)) { return; }
      if (!data.models.length) { throw new Error(`${this.agentName} ne propose aucun modèle disponible.`); }
      const menu: Menu = { token: randomBytes(16).toString('hex'), peer, data, page: 0, expiresAt: Date.now() + 120_000, busy: false };
      this.menu = menu;
      menu.timer = setTimeout(() => { if (this.menu === menu) { this.cancel('⌛ Choix expiré. Rouvrez /model.'); } }, 120_000);
      const view = this.render(menu);
      const sent = await this.client.sendKeyboardMessage(peer.chatId, view.text, view.keyboard);
      menu.messageId = sent.message_id;
      if (this.menu !== menu) { this.close(menu, 'Choix fermé. Rouvrez /model.'); }
    } catch (error) {
      if (generation === this.generation && this.samePeer(peer)) {
        this.cancel();
        await this.client.sendMessage(peer.chatId, `❌ ${error instanceof Error ? error.message : String(error)}`)
          .catch(() => console.warn('[Telegram] Model menu delivery failed.'));
      }
    } finally { this.opening = false; }
  }

  async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const peer = this.peer();
    if (!peer || query.from.id !== peer.userId || query.message?.chat.id !== peer.chatId || query.message.chat.type !== 'private') {
      await this.answer(query.id, 'Non autorisé.');
      return;
    }
    const match = /^model:([a-f0-9]{32}):(pick|effort|page|back|cancel):(\d+)$/.exec(query.data ?? '');
    const menu = this.menu;
    if (!match || !menu || menu.token !== match[1] || !this.samePeer(menu.peer) || menu.messageId !== query.message.message_id) {
      await this.answer(query.id, 'Choix expiré ou invalide. Rouvrez /model.');
      return;
    }
    if (Date.now() >= menu.expiresAt) {
      this.cancel('⌛ Choix expiré. Rouvrez /model.');
      await this.answer(query.id, 'Choix expiré.');
      return;
    }
    if (menu.busy) { await this.answer(query.id, 'Choix en cours de traitement.'); return; }
    const index = Number(match[3]);
    const action = match[2];
    if (action === 'cancel') { this.cancel('Sélection annulée.'); await this.answer(query.id, 'Annulé.'); return; }
    menu.busy = true;
    // Acknowledge promptly; a failed Telegram acknowledgement must not duplicate a selection.
    void this.answer(query.id, 'Choix reçu.');
    try {
      if (action === 'effort') {
        const option = menu.model?.supportedReasoningEfforts[index];
        if (!menu.model || !option) { throw new Error('Effort invalide. Rouvrez /model.'); }
        if (this.isBusy()) { throw new Error(`Une requête ${this.agentName} ou Git est en cours. Attendez sa fin puis rouvrez /model.`); }
        // Consume the menu before the first asynchronous mutation: first click wins.
        this.menu = undefined;
        clearTimeout(menu.timer);
        await this.controls!.select({ model: menu.model.model, effort: option.reasoningEffort }, menu.data.context);
        this.close(menu, `✅ Modèle choisi : ${menu.model.displayName}\nRaisonnement : ${option.reasoningEffort}\nAppliqué à la prochaine demande /${this.promptCommand}.`);
        return;
      }
      if (action === 'pick') {
        if (menu.model || index < menu.page * PAGE_SIZE || index >= (menu.page + 1) * PAGE_SIZE || !menu.data.models[index]) {
          throw new Error('Modèle invalide. Rouvrez /model.');
        }
        menu.model = menu.data.models[index];
      } else if (action === 'page') {
        if (menu.model || !Number.isSafeInteger(index) || index >= Math.ceil(menu.data.models.length / PAGE_SIZE)) {
          throw new Error('Page invalide. Rouvrez /model.');
        }
        menu.page = index;
      } else if (action === 'back') { menu.model = undefined; }
      const view = this.render(menu);
      await this.client.editKeyboardMessage(peer.chatId, menu.messageId!, view.text, view.keyboard);
    } catch (error) {
      if (this.menu === menu) { this.menu = undefined; clearTimeout(menu.timer); }
      this.close(menu, `❌ ${error instanceof Error ? error.message : String(error)}`);
    } finally { menu.busy = false; }
  }

  cancel(text = 'Choix fermé. Rouvrez /model.'): void {
    this.generation++;
    const menu = this.menu;
    this.menu = undefined;
    if (menu) { clearTimeout(menu.timer); this.close(menu, text); }
  }

  private samePeer(peer: TelegramPeer): boolean {
    const current = this.peer();
    return current?.userId === peer.userId && current.chatId === peer.chatId;
  }

  private render(menu: Menu): { text: string; keyboard: TelegramInlineKeyboard } {
    const button = (text: string, action: string, index = 0) => ({ text: text.slice(0, 100), callback_data: `model:${menu.token}:${action}:${index}` });
    if (menu.model) {
      const model = menu.model;
      return { text: `🧠 ${model.displayName.slice(0, 200)} — raisonnement\n\n${model.description.slice(0, 600)}\n\nChoisissez l’effort pour la prochaine demande.`,
        keyboard: { inline_keyboard: [
          ...model.supportedReasoningEfforts.map((option, index) => [button(
            `${option.reasoningEffort}${option.reasoningEffort === model.defaultReasoningEffort ? ' · par défaut' : ''}`, 'effort', index)]),
          [button('‹ Modèles', 'back'), button('Annuler', 'cancel')],
        ] } };
    }
    const pages = Math.ceil(menu.data.models.length / PAGE_SIZE);
    const navigation = [];
    if (menu.page > 0) { navigation.push(button('‹ Précédents', 'page', menu.page - 1)); }
    if (menu.page + 1 < pages) { navigation.push(button('Suivants ›', 'page', menu.page + 1)); }
    const title = this.agentName === 'Antigravity'
      ? `✨ Nexus — modèles Antigravity (${menu.page + 1}/${pages})`
      : `🤖 Nexus — modèles (${menu.page + 1}/${pages})`;
    return { text: `${title}\n\nChoisissez un modèle, puis son effort de raisonnement.\n✓ Modèle sélectionné · ☆ Modèle par défaut\nCe choix sera conservé pour ce workspace.\nLe menu expire après 2 minutes.`,
      keyboard: { inline_keyboard: [
        ...menu.data.models.slice(menu.page * PAGE_SIZE, (menu.page + 1) * PAGE_SIZE).map((model, index) => [button(
          `${model.model === menu.data.selected?.model ? '✓ ' : ''}${model.isDefault ? '☆ ' : ''}${model.displayName}`, 'pick', menu.page * PAGE_SIZE + index)]),
        ...(navigation.length ? [navigation] : []), [button('Annuler', 'cancel')],
      ] } };
  }

  private close(menu: Menu, text: string): void {
    if (menu.messageId !== undefined) {
      void this.client.closeApprovalMessage(menu.peer.chatId, menu.messageId, text.slice(0, 4000))
        .catch(() => this.client.sendMessage(menu.peer.chatId, text.slice(0, 4000)))
        .catch(() => console.warn('[Telegram] Model result delivery failed.'));
    }
  }

  private async answer(id: string, text: string): Promise<void> {
    await this.client.answerCallbackQuery(id, text).catch(() => console.warn('[Telegram] Model callback acknowledgement failed.'));
  }
}
