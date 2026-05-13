import { SupertonicEngine } from './engines/SupertonicEngine';
import { SystemEngine } from './engines/SystemEngine';
import type { Engine } from './engines/Engine';
import type {
  ClonedVoice,
  CloneOptions,
  EngineId,
  PrefetchProgress,
  SpeakOptions,
  StreamHandle,
  Voice,
} from './types';

export type {
  ClonedVoice,
  CloneOptions,
  EngineId,
  PrefetchProgress,
  SpeakOptions,
  StreamHandle,
  Voice,
} from './types';
export type { Engine } from './engines/Engine';
export { parseProsody, stripProsody } from './voices/prosody';
export { SUPERTONIC_VOICES, SUPERTONIC_LANGUAGES } from './voices/catalog';

const engines = new Map<EngineId, Engine>();
engines.set('supertonic', new SupertonicEngine());
engines.set('system', new SystemEngine());

let activeEngineId: EngineId = 'supertonic';

function getEngine(id: EngineId = activeEngineId): Engine {
  const engine = engines.get(id);
  if (!engine) {
    throw new Error(`[speechkit] Engine "${id}" is not registered.`);
  }
  return engine;
}

export const SpeechKit = {
  setEngine(id: EngineId): void {
    if (!engines.has(id)) {
      throw new Error(`[speechkit] Engine "${id}" is not registered.`);
    }
    activeEngineId = id;
  },

  getEngine(): EngineId {
    return activeEngineId;
  },

  registerEngine(engine: Engine): void {
    engines.set(engine.id, engine);
  },

  async isAvailable(engineId?: EngineId): Promise<boolean> {
    return getEngine(engineId).isAvailable();
  },

  async prefetchModel(
    onProgress?: (p: PrefetchProgress) => void,
    engineId?: EngineId
  ): Promise<void> {
    return getEngine(engineId).prefetch(onProgress);
  },

  async getVoices(engineId?: EngineId): Promise<Voice[]> {
    return getEngine(engineId).getVoices();
  },

  async speak(text: string, options: SpeakOptions = {}): Promise<void> {
    return getEngine(options.engine).speak(text, options);
  },

  stream(text: string, options: SpeakOptions = {}): StreamHandle {
    return getEngine(options.engine).stream(text, options);
  },

  async stop(engineId?: EngineId): Promise<void> {
    return getEngine(engineId).stop();
  },

  /** Delete locally cached model files so the next `prefetchModel()` re-downloads.
   *  No-op for engines that don't have a cache (e.g. the system engine). */
  async clearCache(engineId?: EngineId): Promise<void> {
    const engine = getEngine(engineId);
    if (engine.clearCache) {
      await engine.clearCache();
    }
  },

  async cloneVoice(options: CloneOptions, engineId?: EngineId): Promise<ClonedVoice> {
    const engine = getEngine(engineId);
    if (!engine.cloneVoice) {
      throw new Error(`[speechkit] Engine "${engine.id}" does not support voice cloning.`);
    }
    return engine.cloneVoice(options);
  },
};

export default SpeechKit;
