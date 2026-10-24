import { ref, computed, watch, nextTick, type Ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { createNativeSpeechPlayback } from '../utils/native-speech-playback.mjs';
import { createFishSpeechPlayback, normalizeFishReferenceId } from '../utils/fish-speech-playback.mjs';
import { createSpeechPlayback } from '../utils/speech-playback.mjs';
import { cleanTextForSpeech } from '../utils/speech-text.mjs';
import { triggerHaptic } from '../utils/haptics.mjs';
import type { ChatMessage, VoiceBackendStatus } from '../types/nexus';

export function useSpeechPlayback(options: {
  coreUrl: Ref<string>;
  apiUrl: (path?: string) => string;
  getRequestHeaders: () => Record<string, string>;
}) {
  const { coreUrl, apiUrl, getRequestHeaders } = options;

  const voiceBackendStatus = ref<VoiceBackendStatus | null>(null);
  const ttsEnabled = ref<boolean>(true);
  const autoSpeak = ref(true);
  const speechRate = ref(1);
  const speechVoice = ref('');
  const ttsProvider = ref<'fish' | 'system'>('fish');
  const fishReferenceId = ref('');
  const fishModel = ref('s2.1-pro-free');
  const fishApiKeyInput = ref('');
  const isSavingFishConfig = ref(false);
  const fishStatusMsg = ref('');
  const isEditingFishVoice = ref(false);
  const showCustomApiKey = ref(false);
  const fishReferenceDraft = ref('');
  const fishReferenceInputRef = ref<HTMLInputElement | null>(null);
  const speechVoices = ref<SpeechSynthesisVoice[]>([]);
  const isSpeaking = ref<boolean>(false);
  const currentSpeakingId = ref<string | null>(null);
  const speechError = ref('');
  const ttsAvailable = ref(false);

  let speechPlayback:
    | ReturnType<typeof createSpeechPlayback>
    | ReturnType<typeof createNativeSpeechPlayback>
    | ReturnType<typeof createFishSpeechPlayback>
    | undefined;

  function refreshSpeechVoices() {
    speechVoices.value = window.speechSynthesis.getVoices();
  }

  const effectiveFishVoiceId = computed(() => {
    return (
      normalizeFishReferenceId(fishReferenceId.value) ||
      normalizeFishReferenceId(voiceBackendStatus.value?.tts?.referenceId) ||
      ''
    );
  });

  const fishVoiceSourceNote = computed(() => {
    const hasKey = voiceBackendStatus.value?.tts?.hasApiKey;
    const keyNote = hasKey ? 'Clé API active (.env)' : 'Clé API non détectée';
    if (fishReferenceId.value.trim()) {
      return `${keyNote} · Voix personnalisée active`;
    }
    if (voiceBackendStatus.value?.tts?.referenceId) {
      return `${keyNote} · Voix active du fichier .env`;
    }
    return `${keyNote} · Aucune voix configurée`;
  });

  function toggleEditFishVoice() {
    if (isEditingFishVoice.value) {
      isEditingFishVoice.value = false;
      fishReferenceDraft.value = effectiveFishVoiceId.value;
    } else {
      fishReferenceDraft.value = effectiveFishVoiceId.value;
      isEditingFishVoice.value = true;
      nextTick(() => {
        fishReferenceInputRef.value?.focus();
        fishReferenceInputRef.value?.select();
      });
    }
  }

  function onFishInputClick() {
    if (!isEditingFishVoice.value) {
      toggleEditFishVoice();
    }
  }

  watch(
    effectiveFishVoiceId,
    (newVal) => {
      if (!isEditingFishVoice.value) {
        fishReferenceDraft.value = newVal;
      }
    },
    { immediate: true }
  );

  const selectedSystemVoiceLabel = computed(() => {
    if (!speechVoice.value) return 'Automatique · français de France';
    const found = speechVoices.value.find((v) => v.voiceURI === speechVoice.value);
    if (found) return `${found.name} (${found.lang})`;
    return speechVoice.value;
  });

  const selectedFishVoiceLabel = computed(() => {
    const refId = effectiveFishVoiceId.value;
    if (refId) return `Voix personnalisée (${refId.slice(0, 10)}…)`;
    return 'Non configurée (cliquez pour choisir une voix)';
  });

  function stopSpeaking() {
    return speechPlayback?.stop();
  }

  function setTtsProvider(provider: 'fish' | 'system') {
    ttsProvider.value = provider;
    stopSpeaking();
    void triggerHaptic('release');
  }

  watch([ttsEnabled, autoSpeak, speechRate, speechVoice, ttsProvider, fishReferenceId, fishModel], () => {
    if (!ttsEnabled.value) {
      stopSpeaking();
      speechError.value = '';
    }
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('nexus_tts_enabled', String(ttsEnabled.value));
      localStorage.setItem(
        'nexus_tts_preferences',
        JSON.stringify({
          autoSpeak: autoSpeak.value,
          rate: speechRate.value,
          voice: speechVoice.value,
          provider: ttsProvider.value,
          fishReferenceId: normalizeFishReferenceId(fishReferenceId.value),
          fishModel: fishModel.value,
        })
      );
    } catch {
      /* Preferences remain usable for this session when storage is unavailable. */
    }
  });

  async function synthesizeFishSpeech(
    chunkText: string,
    opts: { referenceId?: string; rate?: number; model?: string } = {}
  ): Promise<string> {
    if (!coreUrl.value) {
      throw new Error('Serveur Nexus non configuré');
    }
    const targetUrl = `${apiUrl()}/api/voice/synthesize`;
    const headers = {
      ...getRequestHeaders(),
      'Content-Type': 'application/json',
    };
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: chunkText,
        referenceId:
          normalizeFishReferenceId(opts.referenceId || effectiveFishVoiceId.value) || undefined,
        rate: opts.rate ?? speechRate.value,
        model: opts.model || fishModel.value || 's2.1-pro-free',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.audioBase64) {
      throw new Error(data?.error || `Erreur HTTP ${res.status}`);
    }
    const mimeType = data.mimeType || 'audio/mpeg';
    return `data:${mimeType};base64,${data.audioBase64}`;
  }

  async function saveFishVoiceConfig() {
    const cleanDraft = normalizeFishReferenceId(fishReferenceDraft.value);
    fishReferenceId.value = cleanDraft;
    fishReferenceDraft.value = cleanDraft;
    fishStatusMsg.value = '';
    if (!coreUrl.value) {
      fishStatusMsg.value =
        '✓ Préférence enregistrée localement (connectez le serveur pour synchroniser).';
      isEditingFishVoice.value = false;
      return;
    }
    isSavingFishConfig.value = true;
    try {
      const targetUrl = `${apiUrl()}/api/voice/config`;
      const headers = {
        ...getRequestHeaders(),
        'Content-Type': 'application/json',
      };
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ttsProvider: ttsProvider.value,
          referenceId: cleanDraft,
          model: fishModel.value || 's2.1-pro-free',
          ...(fishApiKeyInput.value.trim() ? { apiKey: fishApiKeyInput.value.trim() } : {}),
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        voiceBackendStatus.value = updated;
        if (updated?.tts?.referenceId !== undefined) {
          fishReferenceId.value = normalizeFishReferenceId(updated.tts.referenceId);
          fishReferenceDraft.value = fishReferenceId.value;
        }
        fishApiKeyInput.value = '';
        showCustomApiKey.value = false;
        isEditingFishVoice.value = false;
        fishStatusMsg.value = '✓ Voix Fish Audio enregistrée';
        void triggerHaptic('success');
      } else {
        fishStatusMsg.value = "⚠ Impossible d'enregistrer sur le serveur.";
      }
    } catch {
      fishStatusMsg.value = '✓ Sauvegardé localement sur cet appareil.';
      isEditingFishVoice.value = false;
    } finally {
      isSavingFishConfig.value = false;
    }
  }

  function speakMessage(text: string, messageId?: string) {
    speechError.value = '';
    if (!ttsEnabled.value) return;
    if (!ttsAvailable.value || !speechPlayback) {
      speechError.value = 'La lecture vocale n’est pas disponible sur cet appareil.';
      return;
    }
    const clean = cleanTextForSpeech(text);
    const useFish =
      ttsProvider.value === 'fish' &&
      Boolean(effectiveFishVoiceId.value || voiceBackendStatus.value?.tts?.fishAudioAvailable);
    if (clean) {
      speechPlayback.speak(clean, messageId, {
        rate: speechRate.value,
        voiceURI: speechVoice.value,
        provider: useFish ? 'fish' : 'system',
        fishEnabled: useFish,
        fishReferenceId: normalizeFishReferenceId(effectiveFishVoiceId.value),
        fishModel: fishModel.value,
      });
    }
  }

  function toggleSpeakMessage(msg: ChatMessage) {
    if (currentSpeakingId.value === msg.id && isSpeaking.value) {
      stopSpeaking();
    } else {
      speakMessage(msg.text, msg.id);
    }
  }

  function toggleTts() {
    ttsEnabled.value = !ttsEnabled.value;
    if (!ttsEnabled.value) {
      stopSpeaking();
    }
    triggerHaptic('light');
  }

  async function fetchVoiceStatus() {
    if (!coreUrl.value) return;
    try {
      const targetUrl = `${apiUrl()}/api/voice/status`;
      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: getRequestHeaders(),
      });
      if (res.ok) {
        const status = await res.json();
        voiceBackendStatus.value = status;
        if (status?.tts) {
          if (status.tts.referenceId && !fishReferenceId.value) {
            fishReferenceId.value = normalizeFishReferenceId(status.tts.referenceId);
          }
          if (status.tts.model && !fishModel.value) {
            fishModel.value = status.tts.model;
          }
        }
      }
    } catch {
      // Non-blocking
    }
  }

  function initTtsEngine() {
    const speechCallbacks = {
      onState: (speaking: boolean, id: string | null) => {
        isSpeaking.value = speaking;
        currentSpeakingId.value = id;
      },
      onError: (message: string) => {
        speechError.value = message;
      },
    };
    let fallbackSpeechPlayback:
      | ReturnType<typeof createSpeechPlayback>
      | ReturnType<typeof createNativeSpeechPlayback>
      | undefined;
    if (Capacitor.isNativePlatform()) {
      const nativeTtsAvailable = Capacitor.isPluginAvailable('TextToSpeech');
      if (nativeTtsAvailable) {
        fallbackSpeechPlayback = createNativeSpeechPlayback(TextToSpeech, speechCallbacks);
        void TextToSpeech.getSupportedVoices()
          .then(({ voices }) => {
            speechVoices.value = voices;
          })
          .catch(() => {
            speechError.value =
              'Vérifiez le moteur vocal et la voix française dans les paramètres Android.';
          });
      }
    } else if (typeof window !== 'undefined') {
      const webTtsAvailable = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
      if (webTtsAvailable) {
        refreshSpeechVoices();
        window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoices);
        fallbackSpeechPlayback = createSpeechPlayback(
          window.speechSynthesis,
          (text: string) => new SpeechSynthesisUtterance(text),
          speechCallbacks
        );
      }
    }
    ttsAvailable.value = Boolean(fallbackSpeechPlayback) || typeof Audio !== 'undefined';
    if (ttsAvailable.value) {
      speechPlayback = createFishSpeechPlayback({
        synthesize: synthesizeFishSpeech,
        createAudio: (src: string) => new Audio(src),
        fallbackPlayer: fallbackSpeechPlayback,
        callbacks: speechCallbacks,
      });
    }

    if (typeof window !== 'undefined') {
      const savedTts = localStorage.getItem('nexus_tts_enabled');
      if (savedTts !== null) {
        ttsEnabled.value = savedTts === 'true';
      }
      try {
        const preferences = JSON.parse(localStorage.getItem('nexus_tts_preferences') || 'null');
        if (preferences && typeof preferences === 'object') {
          if (typeof preferences.autoSpeak === 'boolean') autoSpeak.value = preferences.autoSpeak;
          if (
            typeof preferences.rate === 'number' &&
            preferences.rate >= 0.8 &&
            preferences.rate <= 1.3
          ) {
            speechRate.value = preferences.rate;
          }
          if (typeof preferences.voice === 'string') speechVoice.value = preferences.voice;
          if (preferences.provider === 'fish' || preferences.provider === 'system') {
            ttsProvider.value = preferences.provider;
          }
          if (typeof preferences.fishReferenceId === 'string') {
            fishReferenceId.value = normalizeFishReferenceId(preferences.fishReferenceId);
          }
          if (typeof preferences.fishModel === 'string' && preferences.fishModel.trim()) {
            fishModel.value = preferences.fishModel.trim();
          }
        }
      } catch {
        /* Ignore malformed saved preferences. */
      }
    }
  }

  function cleanupTtsEngine() {
    stopSpeaking();
    if (!Capacitor.isNativePlatform() && ttsAvailable.value && typeof window !== 'undefined') {
      window.speechSynthesis.removeEventListener('voiceschanged', refreshSpeechVoices);
    }
  }

  return {
    voiceBackendStatus,
    ttsEnabled,
    autoSpeak,
    speechRate,
    speechVoice,
    ttsProvider,
    fishReferenceId,
    fishModel,
    fishApiKeyInput,
    isSavingFishConfig,
    fishStatusMsg,
    isEditingFishVoice,
    showCustomApiKey,
    fishReferenceDraft,
    fishReferenceInputRef,
    speechVoices,
    isSpeaking,
    currentSpeakingId,
    speechError,
    ttsAvailable,
    effectiveFishVoiceId,
    fishVoiceSourceNote,
    selectedSystemVoiceLabel,
    selectedFishVoiceLabel,
    toggleEditFishVoice,
    onFishInputClick,
    setTtsProvider,
    saveFishVoiceConfig,
    stopSpeaking,
    speakMessage,
    toggleSpeakMessage,
    toggleTts,
    fetchVoiceStatus,
    initTtsEngine,
    cleanupTtsEngine,
  };
}

