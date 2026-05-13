import { Platform } from 'react-native';

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

  /**
   * Suggest a sensible engine for the current device.
   *
   * - On iOS, always returns `'supertonic'` — every iPhone with iOS 13+ has the
   *   Neural Engine and runs neural TTS well (~1-2s TTFA).
   * - On Android, returns `'supertonic'` for devices that report a recent SoC
   *   with NNAPI 1.2+ acceleration, else `'system'`. The heuristic is
   *   conservative: it errs toward `system` for any mid-range or older device
   *   because Supertonic on a mid-range Snapdragon runs at ~0.5× realtime
   *   (10s+ TTFA), which is worse UX than a robotic but instant system voice.
   * - Defaults to `'supertonic'` on web / unknown platforms.
   *
   * This is opt-in. The library default is still Supertonic everywhere — apps
   * that want graceful fallback should call this once at startup:
   *
   *     SpeechKit.setEngine(SpeechKit.recommendEngine());
   *
   * The detection is heuristic. For a hard guarantee, run a one-time benchmark
   * (synthesize a known short input, measure TTFA, persist the result) and
   * decide based on actual numbers — that's more accurate than any static
   * device-tier list.
   */
  recommendEngine(): EngineId {
    if (Platform.OS === 'ios') return 'supertonic';
    if (Platform.OS !== 'android') return 'supertonic';

    // Android tier detection. We can't read SoC directly from JS, so we rely
    // on what `Platform.constants` exposes: Brand, Manufacturer, Model.
    // The check is "is this likely a flagship / recent device?" — keep it
    // narrow and additive. Anything not on the allow-list falls back to system.
    const c: any = Platform.constants ?? {};
    const brand = String(c.Brand ?? '').toLowerCase();
    const manufacturer = String(c.Manufacturer ?? '').toLowerCase();
    const model = String(c.Model ?? '').toLowerCase();
    const apiLevel = typeof c.Release === 'string' ? parseInt(c.Release, 10) : 0;

    // Android 10 = API 29 = NNAPI 1.2 floor. Below this, NNAPI partitioning
    // is poor enough that ORT often falls back to XNNPACK silently.
    if (apiLevel && apiLevel < 10) return 'system';

    // Pixel 6 and newer have Tensor G1/G2/G3/G4 with a real NPU.
    if (brand === 'google' && /pixel\s*([6-9]|1\d)/.test(model)) return 'supertonic';
    // Samsung S22+ and Tab S8+ are Snapdragon 8 Gen 1 / Exynos 2200 floor.
    if (manufacturer === 'samsung' && /sm-s9\d\d|sm-x[78]\d\d/i.test(model)) return 'supertonic';
    // OnePlus 10 Pro+, current generation flagships are usually safe.
    if (brand === 'oneplus' && /ne|le2\d\d\d/i.test(model)) return 'supertonic';

    // Default for everything else (including the Galaxy A52 you tested on,
    // which has SD720G and gets ~10s TTFA): use the system engine.
    return 'system';
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
