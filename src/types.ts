export type EngineId = 'supertonic' | 'system' | 'neutts' | 'cloud:eleven' | 'cloud:openai' | 'cloud:cartesia';

export type SupertonicLang =
  | 'en' | 'ko' | 'ja' | 'ar' | 'bg' | 'cs' | 'da' | 'de' | 'el' | 'es'
  | 'et' | 'fi' | 'fr' | 'hi' | 'hr' | 'hu' | 'id' | 'it' | 'lt' | 'lv'
  | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sk' | 'sl' | 'sv' | 'tr' | 'uk' | 'vi';

export interface Voice {
  id: string;
  name: string;
  gender?: 'male' | 'female' | 'neutral';
  engine: EngineId;
  language?: string;
  sampleUrl?: string;
}

/**
 * Options for synthesis calls.
 *
 * **Privacy:** the text you pass to `speak()` / `stream()` is processed
 * entirely on-device. It is never sent to a remote server when using the
 * `supertonic` engine. The `system` engine forwards text to the OS-level
 * TTS service (`expo-speech`), which on some platforms (notably some
 * Android OEMs) may route through a cloud service — verify with the
 * device vendor's privacy policy if that matters for your app.
 */
export interface SpeakOptions {
  voice?: string;
  engine?: EngineId;
  /**
   * BCP-47 language code passed to the model.
   * Supertonic-3 supports 31 languages (see SupertonicLang); other engines may
   * use this differently (system engine forwards it as-is to expo-speech).
   */
  language?: string;
  /**
   * Speech speed multiplier (default 1.05 — matches Supertonic upstream).
   * Higher = faster.
   */
  rate?: number;
  pitch?: number;
  volume?: number;
  /**
   * Number of denoising steps for diffusion-based engines (Supertonic).
   * Default 8. Lower = faster but lower quality.
   */
  totalStep?: number;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export interface StreamHandle {
  id: string;
  on(event: 'chunk', listener: (pcm: Uint8Array) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  cancel(): Promise<void>;
}

export interface CloneOptions {
  sampleUri: string;
  name?: string;
}

export interface ClonedVoice {
  id: string;
  name: string;
  engine: EngineId;
}

export interface PrefetchProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}

export interface EngineCapabilities {
  streaming: boolean;
  cloning: boolean;
  emotionTags: boolean;
  offline: boolean;
  languages: string[];
}

export interface SpeechKitError extends Error {
  code:
    | 'ENGINE_NOT_AVAILABLE'
    | 'VOICE_NOT_FOUND'
    | 'MODEL_NOT_LOADED'
    | 'SYNTHESIS_FAILED'
    | 'PERMISSION_DENIED'
    | 'NETWORK_ERROR'
    | 'CANCELLED';
}
