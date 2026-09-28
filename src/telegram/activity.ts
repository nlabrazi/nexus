import { logger } from '../logging/logger';
import { TelegramClient } from './client';

/** Ephemeral feedback: never blocks execution or accumulates parallel requests. */
export function startTyping(
  client: Pick<TelegramClient, 'sendChatAction'>,
  chatId: number,
  signal: AbortSignal,
  isCurrent: () => boolean
): () => void {
  const controller = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  let pending = false;
  const stop = () => {
    clearInterval(timer);
    signal.removeEventListener('abort', stop);
    controller.abort();
  };
  const tick = () => {
    if (requestSignal.aborted || !isCurrent()) {
      stop();
      return;
    }
    if (pending) return;
    pending = true;
    void client
      .sendChatAction(chatId, requestSignal)
      .catch(() => logger.debug('Telegram', 'typing', { status: 'unavailable' }))
      .finally(() => {
        pending = false;
      });
  };
  const timer = setInterval(tick, 4000);
  timer.unref();
  signal.addEventListener('abort', stop, { once: true });
  tick();
  return stop;
}
