import type {
  ClonedVoice,
  CloneOptions,
  EngineCapabilities,
  EngineId,
  PrefetchProgress,
  SpeakOptions,
  StreamHandle,
  Voice,
} from '../types';

export interface Engine {
  readonly id: EngineId;
  readonly capabilities: EngineCapabilities;

  isAvailable(): Promise<boolean>;
  prefetch(onProgress?: (p: PrefetchProgress) => void): Promise<void>;

  getVoices(): Promise<Voice[]>;
  speak(text: string, options?: SpeakOptions): Promise<void>;
  stream(text: string, options?: SpeakOptions): StreamHandle;
  stop(): Promise<void>;

  /** Delete any locally cached model files so the next prefetch re-downloads. */
  clearCache?(): Promise<void>;

  cloneVoice?(options: CloneOptions): Promise<ClonedVoice>;
}
