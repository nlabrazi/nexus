/** A dictated request expects audio, including when the draft was sent manually. */
export function shouldSpeakReply({ enabled, autoSpeak, fromVoice, error = false }) {
  return enabled && !error && (fromVoice || autoSpeak);
}
