/**
 * GTA:SA GENRL (SFX bank) reader — the decode `scripts/spike-genrl.mts` proved GO for the four replay
 * categories (gate G4). It is shared by the spike and by `scripts/bake-map.mts`, which writes the decoded
 * samples into the LOCAL gitignored pak under `audio/`.
 *
 * Format reference: https://gtamods.com/wiki/SFX_(SA). A bank has a 4804-byte header (4 bytes + 400
 * 12-byte SoundMeta records), followed by PCM16 mono. GENRL is not a VER2 IMG archive, so `img-reader.ts`'s
 * VER2 check does not apply. `audio/CONFIG/PakFiles.dat` names the packages; `audio/CONFIG/BankLkup.dat`
 * maps every global bank id to its package, in-package index and PCM extent.
 *
 * No game audio is ever written OUTSIDE the gitignored pak — this module only returns decoded bytes.
 */

/** A GENRL bank header: 4 bytes of sound count + 400 12-byte records. */
export const BANK_HEADER_BYTES = 4804;
/** One SoundMeta record. */
export const SOUND_META_BYTES = 12;
/** Bound on a single sample's PCM range — a corrupt record must not allocate the whole file. */
export const MAX_PCM_BYTES = 16 << 20;
/** Bound on the small `audio/CONFIG/*.dat` tables. */
export const MAX_CONFIG_BYTES = 1 << 20;

/** One bank as `BankLkup.dat` describes it. */
export interface GenrlBank {
  readonly globalBankId: number;
  readonly headerOffset: number;
  readonly packageBankIndex: number;
  readonly pcmBytes: number;
}

/** The two engine families the recorder supports: a jet turbine (Hydra) and a propeller plane (Rustler). */
export type GenrlEngineKind = 'jet' | 'prop';

/** One layer of a model's engine: its role, its relative mix and the GENRL slot it is decoded from. */
export interface GenrlEngineLayer {
  /** Relative mix of this layer in the synthesized engine (inferred tuning; turbine is the unity reference). */
  readonly mix: number;
  readonly role: GenrlEngineRole;
  readonly slot: GenrlEngineSlot;
}

/**
 * The role one baked engine layer plays in the synthesized engine. The Hydra player jet uses the GENRL
 * HARRIER_FRONT/REAR, THRUST and JET_DIST sounds called by ProcessGenericJet in the local game executable.
 * A player propeller aircraft uses front/rear loops from FASTPROP plus near/distant generic layers.
 */
export type GenrlEngineRole =
  | 'accelerate'
  | 'decelerate'
  | 'distance'
  | 'front'
  | 'near'
  | 'prop-distance'
  | 'rear'
  | 'turbine';

/** One engine loop's exact bank/slot/sound provenance. */
export interface GenrlEngineSlot {
  readonly bankName: string;
  readonly globalBankId: number;
  readonly slotId: number;
  readonly slotName: string;
  readonly soundIndex: number;
  /** The gta-reversed `SoundIDs.h` enum name of the sound, or `''` when that bank has no named enum. */
  readonly soundName: string;
}

/**
 * One model's engine source: the exact GENRL banks/slots the game plays for it. The ids and names come from
 * gta-reversed (the game's own hardcoded tables), not from a guess:
 * - `eSoundBank.h` / `SoundIDs.h` name the banks and sounds;
 * - `AEVehicleAudioEntity.VehicleAudioSettings.h` maps a model id (index = model - 400) to its accelerator
 *   bank (`_P`) and decelerator bank (`_D`);
 * - `eSoundBankSlot.h` names the 45 bank slots a bank is loaded into.
 */
export interface GenrlEngineSource {
  readonly kind: GenrlEngineKind;
  /** The layers mixed into the model's engine. Player props use front/rear/near/distant layers. */
  readonly layers: readonly GenrlEngineLayer[];
  readonly model: number;
  /** Why these ids are the right banks for this model — recorded in the pak manifest as provenance. */
  readonly provenance: string;
}

/** One decoded sample plus where it came from. */
export interface GenrlSample {
  readonly bank: GenrlBank;
  readonly pcm: Uint8Array;
  readonly setSoundCount: number;
  readonly sound: GenrlSound;
  readonly spec: GenrlSampleSpec;
}

/** Which bank/slot/sound a replay category maps to — the provenance recorded in the pak manifest. */
export interface GenrlSampleSpec {
  /** The bank's exact name (gta-reversed `eSoundBank.h`), with the numeric id below. */
  readonly bankName: string;
  /** The replay category this sample serves (`engine accelerate`, `collision set`, …). */
  readonly category: string;
  /** File name written into the pak's `audio/` folder. */
  readonly file: string;
  readonly globalBankId: number;
  /** Engine samples: the engine family (`jet` turbine vs `prop` propeller). Absent for collision/explosion. */
  readonly kind?: GenrlEngineKind;
  /** Engine samples: the layer role this sample plays (recorded verbatim in the manifest). */
  readonly layer?: GenrlEngineRole;
  /** Engine samples: the layer's relative mix (recorded verbatim in the manifest). */
  readonly mix?: number;
  /** Engine samples: the model this bank serves (Hydra 520 / Rustler 476). Absent for collision/explosion. */
  readonly model?: number;
  /** Engine samples: why these ids are the right bank for this model (recorded verbatim in the manifest). */
  readonly provenance?: string;
  /** Engine samples: the playback rate this step was baked at (`1` is the source pitch). */
  readonly rate?: number;
  readonly slotId: number;
  readonly slotName: string;
  readonly soundIndex: number;
  /** Engine samples: the gta-reversed `SoundIDs.h` name of the decoded sound. */
  readonly soundName?: string;
  /** Engine samples: the rate-step index (0..n-1). Absent for collision/explosion. */
  readonly step?: number;
}

/** One 12-byte SoundMeta record, decoded. */
export interface GenrlSound {
  readonly bufferOffset: number;
  readonly headroom: number;
  readonly loopOffset: number;
  readonly pcmBytes: number;
  readonly sampleRateHz: number;
}

/** Why one category could not be decoded (corruption self-test relies on the category name). */
export class GenrlDecodeError extends Error {
  constructor(
    readonly category: string,
    message: string,
  ) {
    super(`${category}: ${message}`);
    this.name = 'GenrlDecodeError';
  }
}

/** Playback-rate anchors retained in the pak; both aircraft select the rate-1 source at playback. */
export const ENGINE_STEP_RATES = [0.7, 1, 1.4] as const;

/** The manifest `category` string for each engine layer role (one stable label per role). */
export const GENRL_ENGINE_CATEGORY: Record<GenrlEngineRole, string> = {
  accelerate: 'engine accelerate',
  decelerate: 'engine decelerate',
  distance: 'engine distance',
  front: 'engine front',
  near: 'engine near',
  'prop-distance': 'engine prop distance',
  rear: 'engine rear',
  turbine: 'engine turbine',
};

/** Shared provenance for the per-model engine banks (recorded verbatim per sample in the manifest). */
const ENGINE_PROVENANCE =
  'gta-reversed eSoundBank.h, eSoundBankSlot.h and SoundIDs.h identify the named GENRL banks and sounds. ' +
  'For the local gta_sa.exe SHA1 185b73fbceaa05d66452691fc0d15c8d61b92a7e, the Hydra (520) branch of ' +
  'ProcessGenericJet at 0x4FF900 calls PlayAircraftSound for VEHICLE_GEN slot 19 sounds HARRIER_FRONT 10, ' +
  'HARRIER_REAR 11, THRUST 26 and JET_DIST 14. This is static code evidence; runtime levels and inputs are ' +
  'INFERRED in the replay. Rustler (476): gta-reversed ProcessDummyOrPlayerProp plays FASTPROP sounds 0/1 ' +
  'as FRONT/REAR plus VEHICLE_GEN PROP_NEAR 17 and PROP_DIST 16. FASTPROP_D is not its player path.';

/**
 * The per-model engine layers the replay plays. The banks/slots/sounds are the game's own hardcoded ids —
 * selected by NAME via `GENRL_BANK_NAMES` and `SoundIDs.h`, then checked against the local game call sites.
 * Hydra plays HARRIER_FRONT/REAR + THRUST + JET_DIST; Rustler keeps its player front/rear/near/distant path.
 * Each layer retains {@link ENGINE_STEP_RATES} for manifest compatibility while playback varies one original
 * rate-1 loop per layer to avoid phase beats.
 */
export const GENRL_ENGINE_SOURCES: readonly GenrlEngineSource[] = [
  {
    kind: 'jet',
    layers: [
      {
        mix: 0.7,
        role: 'front',
        slot: {
          bankName: 'SND_BANK_GENRL_VEHICLE_GEN',
          globalBankId: 138,
          slotId: 19,
          slotName: 'SND_BANK_SLOT_VEHICLE_GEN',
          soundIndex: 10,
          soundName: 'SND_GENRL_VEHICLE_GEN_HARRIER_FRONT',
        },
      },
      {
        mix: 0.7,
        role: 'rear',
        slot: {
          bankName: 'SND_BANK_GENRL_VEHICLE_GEN',
          globalBankId: 138,
          slotId: 19,
          slotName: 'SND_BANK_SLOT_VEHICLE_GEN',
          soundIndex: 11,
          soundName: 'SND_GENRL_VEHICLE_GEN_HARRIER_REAR',
        },
      },
      {
        mix: 1,
        role: 'turbine',
        slot: {
          bankName: 'SND_BANK_GENRL_VEHICLE_GEN',
          globalBankId: 138,
          slotId: 19,
          slotName: 'SND_BANK_SLOT_VEHICLE_GEN',
          soundIndex: 26,
          soundName: 'SND_GENRL_VEHICLE_GEN_THRUST',
        },
      },
      {
        mix: 0.25,
        role: 'distance',
        slot: {
          bankName: 'SND_BANK_GENRL_VEHICLE_GEN',
          globalBankId: 138,
          slotId: 19,
          slotName: 'SND_BANK_SLOT_VEHICLE_GEN',
          soundIndex: 14,
          soundName: 'SND_GENRL_VEHICLE_GEN_JET_DIST',
        },
      },
    ],
    model: 520,
    provenance: ENGINE_PROVENANCE,
  },
  {
    kind: 'prop',
    layers: [
      {
        mix: 1,
        role: 'front',
        slot: {
          bankName: 'SND_BANK_GENRL_FASTPROP',
          globalBankId: 53,
          slotId: 40,
          slotName: 'SND_BANK_SLOT_PLAYER_ENGINE_P',
          soundIndex: 0,
          soundName: '',
        },
      },
      {
        mix: 1,
        role: 'rear',
        slot: {
          bankName: 'SND_BANK_GENRL_FASTPROP',
          globalBankId: 53,
          slotId: 40,
          slotName: 'SND_BANK_SLOT_PLAYER_ENGINE_P',
          soundIndex: 1,
          soundName: '',
        },
      },
      {
        mix: 0.3,
        role: 'near',
        slot: {
          bankName: 'SND_BANK_GENRL_VEHICLE_GEN',
          globalBankId: 138,
          slotId: 19,
          slotName: 'SND_BANK_SLOT_VEHICLE_GEN',
          soundIndex: 17,
          soundName: 'SND_GENRL_VEHICLE_GEN_PROP_NEAR',
        },
      },
      {
        mix: 0.2,
        role: 'prop-distance',
        slot: {
          bankName: 'SND_BANK_GENRL_VEHICLE_GEN',
          globalBankId: 138,
          slotId: 19,
          slotName: 'SND_BANK_SLOT_VEHICLE_GEN',
          soundIndex: 16,
          soundName: 'SND_GENRL_VEHICLE_GEN_PROP_DIST',
        },
      },
    ],
    model: 476,
    provenance: ENGINE_PROVENANCE,
  },
];

/**
 * Every sample the replay audio lane bakes, with its exact GENRL provenance. The engine loops are the
 * per-model {@link GENRL_ENGINE_SOURCES} layers expanded into {@link ENGINE_STEP_RATES} rate-steps;
 * Inferred vehicle collisions use the actual CAR surface sound range (20..28), rather than an unrelated
 * representative member of the collision bank. The recording has no measured contact material.
 */
export const GENRL_SAMPLE_SPECS: readonly GenrlSampleSpec[] = [
  ...GENRL_ENGINE_SOURCES.flatMap((source) =>
    source.layers.flatMap((layer) =>
      ENGINE_STEP_RATES.map((rate, step) => ({
        bankName: layer.slot.bankName,
        category: GENRL_ENGINE_CATEGORY[layer.role],
        file: `engine-${source.model}-${layer.role}-${step}.wav`,
        globalBankId: layer.slot.globalBankId,
        kind: source.kind,
        layer: layer.role,
        mix: layer.mix,
        model: source.model,
        provenance: source.provenance,
        rate,
        slotId: layer.slot.slotId,
        slotName: layer.slot.slotName,
        soundIndex: layer.slot.soundIndex,
        soundName: layer.slot.soundName,
        step,
      })),
    ),
  ),
  ...[1, 3, 4, 5, 6, 8, 9, 10, 12].map(
    (carSound, index): GenrlSampleSpec => ({
      bankName: 'SND_BANK_GENRL_COLLISIONS',
      category: 'collision set',
      file: `collision-car-${index + 20}.wav`,
      globalBankId: 39,
      slotId: 2,
      slotName: 'COLLISIONS',
      soundIndex: index + 20,
      soundName: `SND_GENRL_COLLISIONS_COLCAR${String(carSound).padStart(2, '0')}`,
    }),
  ),
  {
    bankName: 'SND_BANK_GENRL_EXPLOSIONS',
    category: 'explosion set',
    file: 'explosion-set.wav',
    globalBankId: 52,
    slotId: 4,
    slotName: 'EXPLOSIONS',
    soundIndex: 0,
  },
];

/**
 * Decode one sample of one bank: bounds-check the bank and the PCM range, then slice the PCM out of the
 * whole-GENRL bytes. Throws {@link GenrlDecodeError} naming the category for any malformed record.
 */
export function decodeGenrlSample(genrl: Uint8Array, bank: GenrlBank, spec: GenrlSampleSpec): GenrlSample {
  const categoryError = (message: string): GenrlDecodeError => new GenrlDecodeError(spec.category, message);
  if (bank.headerOffset + BANK_HEADER_BYTES + bank.pcmBytes > genrl.length)
    throw categoryError('bank exceeds GENRL bounds');
  const header = new DataView(genrl.buffer, genrl.byteOffset + bank.headerOffset, BANK_HEADER_BYTES);
  const soundCount = header.getUint16(0, true);
  if (soundCount < 1 || soundCount > 400) throw categoryError(`invalid sound count ${soundCount}`);
  if (spec.soundIndex >= soundCount) throw categoryError(`missing sound ${spec.soundIndex}`);
  const metaOffset = 4 + spec.soundIndex * SOUND_META_BYTES;
  const nextOffset =
    spec.soundIndex + 1 < soundCount ? header.getUint32(metaOffset + SOUND_META_BYTES, true) : bank.pcmBytes;
  const bufferOffset = header.getUint32(metaOffset, true);
  const pcmBytes = nextOffset - bufferOffset;
  const loopOffset = header.getInt32(metaOffset + 4, true);
  const sampleRateHz = header.getUint16(metaOffset + 8, true);
  if (nextOffset < bufferOffset || nextOffset > bank.pcmBytes || pcmBytes === 0 || pcmBytes % 2 !== 0)
    throw categoryError('invalid PCM range');
  if (pcmBytes > MAX_PCM_BYTES) throw categoryError(`PCM range exceeds ${MAX_PCM_BYTES} bytes`);
  if (sampleRateHz < 4000 || sampleRateHz > 48000) throw categoryError(`invalid sample rate ${sampleRateHz}`);
  if (loopOffset < -1 || loopOffset >= pcmBytes / 2) throw categoryError(`invalid loop point ${loopOffset}`);
  const start = genrl.byteOffset + bank.headerOffset + BANK_HEADER_BYTES + bufferOffset;
  const pcm = genrl.subarray(start, start + pcmBytes);

  return {
    bank,
    pcm,
    setSoundCount: soundCount,
    sound: { bufferOffset, headroom: header.getInt16(metaOffset + 10, true), loopOffset, pcmBytes, sampleRateHz },
    spec,
  };
}

/** Every GENRL bank, keyed by its global bank id (the ids the category specs use). */
export function genrlBanks(
  bytes: Uint8Array,
  packageIndex: number,
  packageCount: number,
): ReadonlyMap<number, GenrlBank> {
  if (bytes.length === 0 || bytes.length % 12 !== 0) throw new Error('BankLkup.dat has an invalid size');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const banks = new Map<number, GenrlBank>();
  let packageBankIndex = 0;
  for (let globalBankId = 0, offset = 0; offset < bytes.length; offset += 12, globalBankId += 1) {
    const recordPackage = view.getUint8(offset);
    if (recordPackage >= packageCount) throw new Error(`BankLkup.dat bank ${globalBankId} has an invalid package`);
    if (recordPackage !== packageIndex) continue;
    banks.set(globalBankId, {
      globalBankId,
      headerOffset: view.getUint32(offset + 4, true),
      packageBankIndex,
      pcmBytes: view.getUint32(offset + 8, true),
    });
    packageBankIndex += 1;
  }

  return banks;
}

/** The package index `GENRL` is mounted as — its banks are the ones decoded here. */
export function genrlPackageIndex(names: readonly string[]): number {
  const index = names.indexOf('GENRL');
  if (index < 0) throw new Error('PakFiles.dat does not map GENRL');

  return index;
}

/** The 52-byte package names `PakFiles.dat` lists, in package order. */
export function genrlPackageNames(bytes: Uint8Array): string[] {
  if (bytes.length === 0 || bytes.length % 52 !== 0) throw new Error('PakFiles.dat has an invalid size');
  const names: string[] = [];
  const decoder = new TextDecoder('ascii');
  for (let offset = 0; offset < bytes.length; offset += 52) {
    let end = -1;
    for (let at = offset; at < offset + 13; at += 1) {
      if (at < bytes.length && bytes[at] === 0) {
        end = at;
        break;
      }
    }
    if (end < offset) throw new Error('PakFiles.dat has an unterminated package name');
    names.push(decoder.decode(bytes.subarray(offset, end)));
  }

  return names;
}

/**
 * A constant-rate resampler for one engine loop: `rate > 1` shortens the buffer (higher pitch), `rate < 1`
 * lengthens it. Linear interpolation, clamped; the output is always a valid PCM16 byte length. This makes an
 * engine loop's rate-step table (`ENGINE_STEP_RATES`) without re-encoding anything.
 */
export function resamplePcm16(pcm: Uint8Array, rate: number): Uint8Array {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error('PCM16 must have a non-zero, even byte length');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`invalid resample rate ${rate}`);
  }
  const frames = pcm.length / 2;
  const outputFrames = Math.max(1, Math.round(frames / rate));
  const source = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const output = new Uint8Array(outputFrames * 2);
  const view = new DataView(output.buffer);
  const read = (index: number): number => (index >= 0 && index < frames ? source.getInt16(index * 2, true) : 0);
  for (let index = 0; index < outputFrames; index += 1) {
    const position = index * rate;
    const whole = Math.floor(position);
    const fraction = position - whole;
    const value = read(whole) + (read(whole + 1) - read(whole)) * fraction;
    view.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(value))), true);
  }

  return output;
}

/** Tail->head crossfade length (seconds) used to make a baked engine loop seamless. */
export const ENGINE_LOOP_CROSSFADE_SECONDS = 0.02;
/** Short equal-power join for the original Hydra HARRIER_FRONT/REAR loops. */
export const ENGINE_JET_MAIN_CROSSFADE_SECONDS = 0.005;
/** The player prop front/rear sources already have close endpoints; a long blend makes a periodic volume dip. */
export const ENGINE_PROP_MAIN_CROSSFADE_SECONDS = 0.002;

/**
 * Turn a raw GENRL loop into a SEAMLESS loop: crossfade the last `crossfadeFrames` frames into the first
 * `crossfadeFrames`, then drop the tail. The result's end connects continuously to its start, so the replay can
 * loop the whole buffer without cycling an attack or a seam discontinuity. `crossfadeFrames` is clamped to a
 * quarter of the loop, and a loop too short to blend is copied unchanged.
 */
export function makeSeamlessLoop(
  pcm: Uint8Array,
  crossfadeFrames: number,
  mode: 'equal-power' | 'linear' = 'linear',
): Uint8Array {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new Error('PCM16 must have a non-zero, even byte length');
  }
  const frames = pcm.length / 2;
  const requested = Number.isFinite(crossfadeFrames) ? Math.floor(crossfadeFrames) : 0;
  const blend = Math.max(0, Math.min(requested, Math.floor(frames / 4)));
  if (blend < 1) {
    return pcm.slice();
  }
  const outputFrames = frames - blend;
  const source = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const output = new Uint8Array(outputFrames * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < outputFrames; index += 1) {
    let value: number;
    if (index < blend) {
      const phase = index / blend;
      const headWeight = mode === 'equal-power' ? Math.sin((phase * Math.PI) / 2) : phase;
      const tailWeight = mode === 'equal-power' ? Math.cos((phase * Math.PI) / 2) : 1 - phase;
      value =
        source.getInt16(index * 2, true) * headWeight + source.getInt16((outputFrames + index) * 2, true) * tailWeight;
    } else {
      value = source.getInt16(index * 2, true);
    }
    view.setInt16(index * 2, Math.max(-32768, Math.min(32767, Math.round(value))), true);
  }

  return output;
}

/** Wrap PCM16 mono into a canonical 44-byte-header WAV. */
export function wavBytes(pcm: Uint8Array, sampleRateHz: number): Uint8Array {
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, wav.length - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);

  return wav;
}

/** Read a WAV's own header back: its byte size and frame count. Throws when it is not canonical PCM16. */
export function wavInfo(wav: Uint8Array): { bytes: number; frames: number } {
  if (wav.length < 44) throw new Error('WAV is shorter than its header');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (offset: number, length: number): string => {
    let text = '';
    for (let at = offset; at < offset + length; at += 1) text += String.fromCharCode(wav[at]);

    return text;
  };
  const dataBytes = view.getUint32(40, true);
  const valid =
    tag(0, 4) === 'RIFF' &&
    tag(8, 4) === 'WAVE' &&
    tag(12, 4) === 'fmt ' &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint16(34, true) === 16 &&
    tag(36, 4) === 'data' &&
    wav.length === 44 + dataBytes;
  if (!valid || dataBytes % 2 !== 0) throw new Error('WAV validation failed');

  return { bytes: wav.length, frames: dataBytes / 2 };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let at = 0; at < text.length; at += 1) view.setUint8(offset + at, text.charCodeAt(at));
}
