import type {
  EngineCapabilities,
  EngineId,
  PrefetchProgress,
  SpeakOptions,
  StreamHandle,
  Voice,
} from '../types';
import type { Engine } from './Engine';

type ExpoSpeechModule = {
  speak(text: string, options?: any): void;
  stop(): Promise<void>;
  getAvailableVoicesAsync(): Promise<Array<{ identifier: string; name: string; language: string }>>;
};

let cached: ExpoSpeechModule | null = null;
function loadExpoSpeech(): ExpoSpeechModule | null {
  if (cached) return cached;
  try {
    cached = require('expo-speech') as ExpoSpeechModule;
    return cached;
  } catch {
    return null;
  }
}

export class SystemEngine implements Engine {
  readonly id: EngineId = 'system';
  readonly capabilities: EngineCapabilities = {
    streaming: false,
    cloning: false,
    emotionTags: false,
    offline: true,
    languages: ['*'],
  };

  async isAvailable(): Promise<boolean> {
    return loadExpoSpeech() !== null;
  }

  async prefetch(_onProgress?: (p: PrefetchProgress) => void): Promise<void> {
    // No-op: system voices are bundled with the OS.
  }

  async getVoices(): Promise<Voice[]> {
    const speech = loadExpoSpeech();
    if (!speech) return [];
    const voices = await speech.getAvailableVoicesAsync();
    return voices.map((v) => ({
      id: v.identifier,
      name: v.name,
      language: v.language,
      engine: 'system' as EngineId,
    }));
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    const speech = loadExpoSpeech();
    if (!speech) {
      throw new Error('[ttskit] expo-speech is not installed');
    }
    return new Promise((resolve, reject) => {
      try {
        speech.speak(text, {
          voice: options.voice,
          language: options.language,
          rate: options.rate,
          pitch: options.pitch,
          volume: options.volume,
          onStart: options.onStart,
          onDone: () => {
            options.onDone?.();
            resolve();
          },
          onError: (err: Error) => {
            options.onError?.(err);
            reject(err);
          },
          onStopped: () => resolve(),
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  stream(_text: string, _options: SpeakOptions = {}): StreamHandle {
    throw new Error('[ttskit] System engine does not support streaming. Use engine: "supertonic".');
  }

  async stop(): Promise<void> {
    const speech = loadExpoSpeech();
    await speech?.stop();
  }
}
