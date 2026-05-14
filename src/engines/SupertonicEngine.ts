import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type {
  EngineCapabilities,
  EngineId,
  PrefetchProgress,
  SpeakOptions,
  StreamHandle,
  Voice,
} from '../types';

// iOS has CoreML/ANE fp16 acceleration; even an 8-step diffusion takes ~1s.
// Android relies on NNAPI + commodity SoCs (e.g. Snapdragon 720G in mid-tier
// phones) and tops out around 1-1.2s per diffusion step at fp32, so 8 steps
// stretches synthesis to 10-14s. Supertonic-3 was trained for 2-8 step
// inference; 6 steps is the quality/speed sweet spot on Android — audibly
// closer to 8-step than to 4-step, while still ~25% faster than 8.
// Callers can override per-call via SpeakOptions.totalStep.
const DEFAULT_TOTAL_STEP = Platform.OS === 'android' ? 6 : 8;
import { BufferedStreamEmitter } from './BufferedStreamEmitter';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE_ID,
  SUPERTONIC_LANGUAGES,
  SUPERTONIC_VOICES,
  findVoice,
} from '../voices/catalog';
import { stripProsody } from '../voices/prosody';
import type { Engine } from './Engine';

type Subscription = { remove(): void };
type ChunkPayload = { id: string; pcm: string };
type IdPayload = { id: string };
type ErrorPayload = { id: string; message: string };

interface TTSKitNative {
  isAvailable(): Promise<boolean>;
  prefetch(): Promise<void>;
  speak(
    id: string,
    text: string,
    voiceId: string,
    lang: string,
    totalStep: number,
    speed: number,
    volume: number
  ): Promise<void>;
  stream(
    id: string,
    text: string,
    voiceId: string,
    lang: string,
    totalStep: number,
    speed: number,
    volume: number
  ): Promise<void>;
  stop(): Promise<void>;
  clearCache(): Promise<void>;
  addListener(name: string, listener: (event: any) => void): Subscription;
}

let nativeModule: TTSKitNative | null = null;
function getNative(): TTSKitNative {
  if (!nativeModule) {
    nativeModule = requireNativeModule<TTSKitNative>('RNTTSKit');
  }
  return nativeModule;
}

let counter = 0;
const newId = () => `op_${Date.now().toString(36)}_${(++counter).toString(36)}`;

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const cleaned = b64.replace(/=+$/, '');
  const out = new Uint8Array((cleaned.length * 3) >> 2);
  let o = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const a = lookup.indexOf(cleaned[i]);
    const b = lookup.indexOf(cleaned[i + 1]);
    const c = lookup.indexOf(cleaned[i + 2] ?? 'A');
    const d = lookup.indexOf(cleaned[i + 3] ?? 'A');
    out[o++] = (a << 2) | (b >> 4);
    if (cleaned[i + 2]) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (cleaned[i + 3]) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

// BufferedStreamEmitter is exported from its own module so we can unit-test
// it without needing the native module to load. See ./BufferedStreamEmitter.ts

function resolveLang(options: SpeakOptions): string {
  const lang = options.language ?? DEFAULT_LANGUAGE;
  if (!SUPERTONIC_LANGUAGES.includes(lang)) {
    throw new Error(`[ttskit] Unsupported language for Supertonic: ${lang}`);
  }
  return lang;
}

export class SupertonicEngine implements Engine {
  readonly id: EngineId = 'supertonic';
  readonly capabilities: EngineCapabilities = {
    streaming: true,
    cloning: false,
    emotionTags: false,
    offline: true,
    languages: [...SUPERTONIC_LANGUAGES],
  };

  async isAvailable(): Promise<boolean> {
    try {
      return await getNative().isAvailable();
    } catch {
      return false;
    }
  }

  async prefetch(onProgress?: (p: PrefetchProgress) => void): Promise<void> {
    const native = getNative();
    const sub = onProgress
      ? native.addListener('onPrefetchProgress', (e: PrefetchProgress) => onProgress(e))
      : null;
    try {
      await native.prefetch();
    } finally {
      sub?.remove();
    }
  }

  async getVoices(): Promise<Voice[]> {
    return SUPERTONIC_VOICES;
  }

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const voiceId = options.voice ?? DEFAULT_VOICE_ID;
    if (!findVoice(voiceId)) throw new Error(`[ttskit] Unknown voice: ${voiceId}`);
    const lang = resolveLang(options);
    const id = newId();
    const native = getNative();
    const cleanText = stripProsody(text);

    const subs: Subscription[] = [];
    if (options.onStart) {
      subs.push(native.addListener('onSpeakStart', (e: IdPayload) => {
        if (e.id === id) options.onStart?.();
      }));
    }
    if (options.onDone) {
      subs.push(native.addListener('onSpeakDone', (e: IdPayload) => {
        if (e.id === id) options.onDone?.();
      }));
    }
    try {
      await native.speak(
        id,
        cleanText,
        voiceId,
        lang,
        options.totalStep ?? DEFAULT_TOTAL_STEP,
        options.rate ?? 1.05,
        options.volume ?? 1
      );
    } catch (err) {
      options.onError?.(err as Error);
      throw err;
    } finally {
      subs.forEach((s) => s.remove());
    }
  }

  stream(text: string, options: SpeakOptions = {}): StreamHandle {
    const voiceId = options.voice ?? DEFAULT_VOICE_ID;
    if (!findVoice(voiceId)) throw new Error(`[ttskit] Unknown voice: ${voiceId}`);
    const lang = resolveLang(options);

    const id = newId();
    const native = getNative();
    const emitter = new BufferedStreamEmitter();
    const cleanText = stripProsody(text);
    let cleanedUp = false;

    const chunkSub = native.addListener('onStreamChunk', (e: ChunkPayload) => {
      if (e.id !== id) return;
      emitter.emitChunk(decodeBase64(e.pcm));
    });
    const endSub = native.addListener('onStreamEnd', (e: IdPayload) => {
      if (e.id !== id) return;
      emitter.emitEnd();
      cleanup();
    });
    const errSub = native.addListener('onStreamError', (e: ErrorPayload) => {
      if (e.id !== id) return;
      emitter.emitError(new Error(e.message));
      cleanup();
    });

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      chunkSub.remove();
      endSub.remove();
      errSub.remove();
    }

    native
      .stream(
        id,
        cleanText,
        voiceId,
        lang,
        options.totalStep ?? DEFAULT_TOTAL_STEP,
        options.rate ?? 1.05,
        options.volume ?? 1
      )
      .catch((err: Error) => {
        emitter.emitError(err);
        cleanup();
      });

    const handle: StreamHandle = {
      id,
      on(event: 'chunk' | 'end' | 'error', listener: (...args: any[]) => void) {
        // @ts-expect-error: emitter has overloaded signatures, runtime forwards correctly
        emitter.on(event, listener);
        return handle;
      },
      async cancel() {
        cleanup();
        await native.stop();
      },
    };
    return handle;
  }

  async stop(): Promise<void> {
    await getNative().stop();
  }

  async clearCache(): Promise<void> {
    await getNative().clearCache();
  }
}
