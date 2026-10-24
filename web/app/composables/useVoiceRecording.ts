import { ref, type Ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { triggerHaptic } from '../utils/haptics.mjs';

export function useVoiceRecording(options: {
  inputPrompt: Ref<string>;
  draftFromVoice: Ref<boolean>;
  isSending: Ref<boolean>;
  isNodeReady: Ref<boolean>;
  errorMessage: Ref<string>;
  apiUrl: (path?: string) => string;
  getRequestHeaders: () => Record<string, string>;
  stopSpeaking: () => unknown;
  submitMessage: () => Promise<void>;
}) {
  const {
    inputPrompt,
    draftFromVoice,
    isSending,
    isNodeReady,
    errorMessage,
    apiUrl,
    getRequestHeaders,
    stopSpeaking,
    submitMessage,
  } = options;

  const isListening = ref<boolean>(false);
  const isProcessingAudio = ref<boolean>(false);
  const interimTranscript = ref<string>('');
  const autoSendVoice = ref<boolean>(true);

  let recognitionInstance: any = null;
  let mediaRecorderInstance: MediaRecorder | null = null;
  let mediaStreamInstance: MediaStream | null = null;
  let recordedAudioChunks: Blob[] = [];
  let speechRecordingStart = 0;
  let isPressingMic = false;
  let clickToggleActive = false;
  let nativeSpeechActive = false;
  let nativeRecorderActive = false;
  let nativeSpeechStopTimer: ReturnType<typeof setTimeout> | null = null;

  function appendTranscript(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (inputPrompt.value) {
      inputPrompt.value = `${inputPrompt.value} ${trimmed}`;
    } else {
      inputPrompt.value = trimmed;
    }
    draftFromVoice.value = true;
    interimTranscript.value = '';
  }

  function initSpeechRecognition() {
    if (typeof window === 'undefined') return;
    const savedAutoSend = localStorage.getItem('nexus_auto_send_voice');
    if (savedAutoSend !== null) {
      autoSendVoice.value = savedAutoSend === 'true';
    }

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      try {
        const recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'fr-FR';

        recognition.onresult = (event: any) => {
          let finalChunk = '';
          let interimChunk = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalChunk += event.results[i][0].transcript;
            } else {
              interimChunk += event.results[i][0].transcript;
            }
          }
          if (interimChunk) {
            interimTranscript.value = interimChunk;
          }
          if (finalChunk) {
            appendTranscript(finalChunk);
          }
        };

        recognition.onerror = (event: any) => {
          console.warn('SpeechRecognition error:', event.error);
          if (event.error !== 'no-speech') {
            interimTranscript.value = '';
          }
        };

        recognition.onend = () => {
          if (isListening.value && !clickToggleActive) {
            isListening.value = false;
          }
        };

        recognitionInstance = recognition;
      } catch (e) {
        console.warn('Failed to initialize SpeechRecognition:', e);
      }
    }
  }

  async function stopNativeSpeechRecognition(settleMs = 0) {
    if (nativeSpeechStopTimer) {
      clearTimeout(nativeSpeechStopTimer);
      nativeSpeechStopTimer = null;
    }
    try {
      await Promise.race([
        SpeechRecognition.stop().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(80, settleMs))),
      ]);
    } catch {}
    try {
      await SpeechRecognition.removeAllListeners();
    } catch {}
  }

  async function transcribeNativeAudio(base64: string, mimeType: string) {
    try {
      const targetUrl = `${apiUrl()}/api/voice/transcribe`;
      const headers = {
        ...getRequestHeaders(),
        'Content-Type': 'application/json',
      };
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: mimeType || 'audio/aac',
          language: 'fr',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          appendTranscript(data.text);
        }
      }
    } catch (err) {
      console.warn('Native audio backend transcription failed:', err);
    }
  }

  async function blobToBase64(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function transcribeAudioBlob(blob: Blob) {
    try {
      const base64 = await blobToBase64(blob);
      await transcribeNativeAudio(base64, blob.type || 'audio/webm');
    } catch (err) {
      console.warn('Backend transcription failed:', err);
    }
  }

  async function startPushToTalk() {
    await stopSpeaking();
    if (isSending.value || isProcessingAudio.value) return;

    if (nativeSpeechStopTimer) {
      clearTimeout(nativeSpeechStopTimer);
      nativeSpeechStopTimer = null;
    }
    speechRecordingStart = Date.now();
    interimTranscript.value = '';
    errorMessage.value = '';
    isListening.value = true;
    await triggerHaptic('press');

    if (Capacitor.isNativePlatform()) {
      let speechAvailable = false;
      try {
        const avail = await SpeechRecognition.available();
        if (avail.available) {
          const perm = await SpeechRecognition.checkPermissions();
          if (perm.speechRecognition !== 'granted') {
            const req = await SpeechRecognition.requestPermissions();
            speechAvailable = req.speechRecognition === 'granted';
          } else {
            speechAvailable = true;
          }
        }
      } catch (e) {
        console.warn('SpeechRecognition check failed:', e);
      }

      if (speechAvailable) {
        try {
          nativeSpeechActive = true;
          await SpeechRecognition.removeAllListeners();
          await SpeechRecognition.addListener(
            'partialResults',
            (data: { matches: string[] }) => {
              if (data.matches && data.matches.length > 0) {
                const candidate = data.matches[0]?.trim() || '';
                if (candidate) {
                  interimTranscript.value = candidate;
                }
              }
            }
          );
          await SpeechRecognition.addListener(
            "listeningState",
            (state: { status: 'started' | 'stopped' }) => {
              if (state.status === 'stopped' && isListening.value && nativeSpeechActive) {
                if (nativeSpeechStopTimer) clearTimeout(nativeSpeechStopTimer);
                nativeSpeechStopTimer = setTimeout(() => {
                  nativeSpeechStopTimer = null;
                  if (isListening.value && nativeSpeechActive) {
                    void stopPushToTalk();
                  }
                }, 240);
              }
            }
          );
          await SpeechRecognition.start({
            language: 'fr-FR',
            maxResults: 3,
            partialResults: true,
            popup: false,
          });
          return;
        } catch (err) {
          console.warn(
            'SpeechRecognition.start inline failed, fallback to VoiceRecorder:',
            err
          );
          nativeSpeechActive = false;
        }
      }

      try {
        const perm = await VoiceRecorder.hasAudioRecordingPermission();
        if (!perm.value) {
          const req = await VoiceRecorder.requestAudioRecordingPermission();
          if (!req.value) {
            isListening.value = false;
            errorMessage.value = 'Autorisation du micro requise pour la dictée vocale.';
            return;
          }
        }
        nativeRecorderActive = true;
        await VoiceRecorder.startRecording();
        return;
      } catch (err) {
        console.warn('VoiceRecorder.startRecording failed:', err);
        nativeRecorderActive = false;
        isListening.value = false;
        errorMessage.value = 'Reconnaissance vocale non disponible sur cet appareil.';
        return;
      }
    }

    if (recognitionInstance) {
      try {
        recognitionInstance.start();
        return;
      } catch {
        // Fallback MediaRecorder
      }
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      typeof MediaRecorder !== 'undefined'
    ) {
      try {
        recordedAudioChunks = [];
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamInstance = stream;
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedAudioChunks.push(e.data);
          }
        };
        recorder.start(100);
        mediaRecorderInstance = recorder;
      } catch (err: any) {
        console.warn('MediaRecorder error:', err);
        isListening.value = false;
        isPressingMic = false;
      }
    }
  }

  async function stopPushToTalk() {
    if (!isListening.value && !isPressingMic) return;

    const durationMs = Date.now() - speechRecordingStart;
    isPressingMic = false;
    clickToggleActive = false;
    isListening.value = false;
    await triggerHaptic('release');

    if (Capacitor.isNativePlatform()) {
      if (nativeSpeechActive) {
        try {
          await stopNativeSpeechRecognition(220);
          const text = interimTranscript.value.trim();
          if (text) {
            appendTranscript(text);
          }
        } catch (err) {
          console.warn('SpeechRecognition.stop failed:', err);
          if (interimTranscript.value.trim()) {
            appendTranscript(interimTranscript.value.trim());
          }
        } finally {
          nativeSpeechActive = false;
        }
      }

      if (nativeRecorderActive) {
        isProcessingAudio.value = true;
        try {
          const result = await VoiceRecorder.stopRecording();
          if (result.value?.recordDataBase64 && durationMs > 250) {
            await transcribeNativeAudio(
              result.value.recordDataBase64,
              result.value.mimeType || 'audio/aac'
            );
          }
        } catch (err) {
          console.warn('VoiceRecorder.stopRecording failed:', err);
        } finally {
          nativeRecorderActive = false;
          isProcessingAudio.value = false;
        }
      }

      if (
        autoSendVoice.value &&
        isNodeReady.value &&
        inputPrompt.value.trim().length > 0 &&
        durationMs > 250
      ) {
        await submitMessage();
      }
      return;
    }

    if (recognitionInstance) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const prevOnEnd = recognitionInstance.onend;
        recognitionInstance.onend = (ev: any) => {
          recognitionInstance.onend = prevOnEnd;
          if (typeof prevOnEnd === 'function') prevOnEnd(ev);
          done();
        };
        setTimeout(() => {
          recognitionInstance.onend = prevOnEnd;
          done();
        }, 240);
        try {
          recognitionInstance.stop();
        } catch {
          recognitionInstance.onend = prevOnEnd;
          done();
        }
      });
      if (interimTranscript.value.trim()) {
        appendTranscript(interimTranscript.value.trim());
      }
    }

    if (mediaRecorderInstance && mediaRecorderInstance.state !== 'inactive') {
      isProcessingAudio.value = true;
      try {
        const audioBlob = await new Promise<Blob>((resolve) => {
          mediaRecorderInstance!.onstop = () => {
            const blob = new Blob(recordedAudioChunks, {
              type: mediaRecorderInstance!.mimeType || 'audio/webm',
            });
            resolve(blob);
          };
          mediaRecorderInstance!.stop();
        });

        if (mediaStreamInstance) {
          for (const track of mediaStreamInstance.getTracks()) {
            track.stop();
          }
          mediaStreamInstance = null;
        }
        mediaRecorderInstance = null;

        if (audioBlob.size > 1000) {
          await transcribeAudioBlob(audioBlob);
        }
      } catch (err: any) {
        console.warn('Error processing audio recording:', err);
      } finally {
        isProcessingAudio.value = false;
      }
    }

    if (
      autoSendVoice.value &&
      isNodeReady.value &&
      inputPrompt.value.trim().length > 0 &&
      durationMs > 250
    ) {
      await submitMessage();
    }
  }

  async function handleMicClick() {
    if (isSending.value || isProcessingAudio.value) return;

    if (isListening.value) {
      clickToggleActive = false;
      await stopPushToTalk();
    } else {
      clickToggleActive = true;
      await startPushToTalk();
    }
  }

  async function cancelVoiceRecording() {
    isListening.value = false;
    isPressingMic = false;
    clickToggleActive = false;
    interimTranscript.value = '';
    await triggerHaptic('cancel');

    if (Capacitor.isNativePlatform()) {
      if (nativeSpeechActive) {
        await stopNativeSpeechRecognition(80);
        nativeSpeechActive = false;
      }
      if (nativeRecorderActive) {
        try {
          await VoiceRecorder.stopRecording();
        } catch {}
        nativeRecorderActive = false;
      }
      return;
    }

    if (recognitionInstance) {
      try {
        recognitionInstance.abort();
      } catch {}
    }
    if (mediaRecorderInstance && mediaRecorderInstance.state !== 'inactive') {
      try {
        mediaRecorderInstance.stop();
      } catch {}
    }
    if (mediaStreamInstance) {
      for (const track of mediaStreamInstance.getTracks()) {
        track.stop();
      }
      mediaStreamInstance = null;
    }
    mediaRecorderInstance = null;
  }

  return {
    isListening,
    isProcessingAudio,
    interimTranscript,
    autoSendVoice,
    initSpeechRecognition,
    stopNativeSpeechRecognition,
    handleMicClick,
    startPushToTalk,
    stopPushToTalk,
    cancelVoiceRecording,
  };
}

