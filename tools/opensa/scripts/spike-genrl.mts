/**
 * G4 feasibility spike for local GTA:SA GENRL SFX decoding.
 *
 * The reader itself lives in `scripts/lib/genrl.ts` (shared with `bake-map.mts`); this script drives it over
 * the owner's install, validates each decoded sample as a transient on-disk WAV, writes the gate evidence
 * and deletes the temp audio. Run:
 *
 * Run: npx tsx scripts/spike-genrl.mts --game "../../GTA San Andreas" [--self-test-corrupt]
 */
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeGenrlSample,
  genrlBanks,
  genrlPackageIndex,
  genrlPackageNames,
  GENRL_SAMPLE_SPECS,
  GenrlDecodeError,
  MAX_CONFIG_BYTES,
  MAX_PCM_BYTES,
  wavBytes,
  wavInfo,
} from './lib/genrl';
import type { GenrlBank } from './lib/genrl';

const MAX_GENRL_BYTES = 64 << 20;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EVIDENCE = path.join(REPO_ROOT, '.omo/evidence/gate-G4-flight-analysis-remediation-and-worktree-cleanup.json');

interface CategoryEvidence {
  readonly bankName: string;
  readonly category: string;
  readonly globalBankId: number;
  readonly headroom: number;
  readonly loopStartFrame: number | null;
  readonly packageBankIndex: number;
  readonly pcmBytes: number;
  readonly sampleRateHz: number;
  readonly selectedSoundIndex: number;
  readonly setSoundCount: number;
  readonly slotId: number;
  readonly slotName: string;
  readonly wavBytes: number;
  readonly wavFrames: number;
}

interface RunResult {
  readonly evidence: object;
  readonly summary: string;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function readBounded(file: string, maximum: number): Promise<Buffer> {
  const info = await stat(file);
  if (info.size > maximum) throw new Error(`${path.basename(file)} exceeds bounded read limit (${info.size} bytes)`);
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(info.size);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead !== bytes.length) throw new Error(`short read from ${path.basename(file)}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** Write the WAV to disk, read it back whole and validate it with the shared header reader. */
async function validateTransientWav(tempRoot: string, index: number, pcm: Uint8Array, sampleRateHz: number): Promise<{ bytes: number; frames: number }> {
  const file = path.join(tempRoot, `${index}.wav`);
  await writeFile(file, wavBytes(pcm, sampleRateHz));
  const written = await readBounded(file, MAX_PCM_BYTES + 64);
  return wavInfo(written);
}

async function inspect(genrl: Uint8Array, banks: ReadonlyMap<number, GenrlBank>, tempRoot: string): Promise<readonly CategoryEvidence[]> {
  const evidence: CategoryEvidence[] = [];
  for (const [index, spec] of GENRL_SAMPLE_SPECS.entries()) {
    const bank = banks.get(spec.globalBankId);
    if (!bank) throw new GenrlDecodeError(spec.category, `GENRL bank ${spec.globalBankId} is absent`);
    const decoded = decodeGenrlSample(genrl, bank, spec);
    const wav = await validateTransientWav(tempRoot, index, decoded.pcm, decoded.sound.sampleRateHz);
    const row: CategoryEvidence = {
      bankName: spec.bankName, category: spec.category, globalBankId: bank.globalBankId,
      headroom: decoded.sound.headroom, loopStartFrame: decoded.sound.loopOffset < 0 ? null : decoded.sound.loopOffset,
      packageBankIndex: bank.packageBankIndex, pcmBytes: decoded.sound.pcmBytes,
      sampleRateHz: decoded.sound.sampleRateHz, selectedSoundIndex: spec.soundIndex,
      setSoundCount: decoded.setSoundCount, slotId: spec.slotId, slotName: spec.slotName,
      wavBytes: wav.bytes, wavFrames: wav.frames,
    };
    evidence.push(row);
    console.log(`${row.category}: bank ${row.globalBankId}/${row.packageBankIndex}, slot ${row.slotId} ${row.slotName}, sound ${row.selectedSoundIndex}/${row.setSoundCount}, loop ${row.loopStartFrame ?? 'none'}, ${row.wavFrames} frames @ ${row.sampleRateHz} Hz; WAV validated`);
  }
  return evidence;
}

async function writeEvidence(value: object): Promise<void> {
  await mkdir(path.dirname(EVIDENCE), { recursive: true });
  await writeFile(EVIDENCE, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const gameValue = argument('--game');
  if (!gameValue) throw new Error('usage: spike-genrl.mts --game <GTA San Andreas> [--self-test-corrupt]');
  const game = path.resolve(gameValue);
  const config = path.join(game, 'audio', 'CONFIG');
  const genrl = path.join(game, 'audio', 'SFX', 'GENRL');
  try { await access(genrl, constants.R_OK); } catch (error) {
    if (error instanceof Error) console.error(`BLOCKED: GENRL is missing or unreadable at ${genrl}`);
    process.exitCode = 2;
    return;
  }
  const names = genrlPackageNames(await readBounded(path.join(config, 'PakFiles.dat'), MAX_CONFIG_BYTES));
  const packageIndex = genrlPackageIndex(names);
  const banks = genrlBanks(await readBounded(path.join(config, 'BankLkup.dat'), MAX_CONFIG_BYTES), packageIndex, names.length);
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'gtasa-genrl-g4-'));
  let result: RunResult | null = null;
  try {
    if (process.argv.includes('--self-test-corrupt')) {
      const corrupt = path.join(tempRoot, 'GENRL-corrupt');
      await copyFile(genrl, corrupt);
      const collision = banks.get(39);
      if (!collision) throw new Error('self-test requires collision bank 39');
      const handle = await open(corrupt, 'r+');
      try { await handle.write(Buffer.from([0xff]), 0, 1, collision.headerOffset + 1); } finally { await handle.close(); }
      let failedCategory: string | null = null;
      try { await inspect(await readBounded(corrupt, MAX_GENRL_BYTES), banks, tempRoot); } catch (error) {
        if (error instanceof GenrlDecodeError) failedCategory = error.category; else throw error;
      }
      if (failedCategory !== 'collision set') throw new Error(`corrupt self-test failed to name collision set (got ${failedCategory ?? 'GO'})`);
      result = {
        evidence: { GENRL: 'NO-GO', categoriesDecodedBeforeFailure: 2, categoryCount: GENRL_SAMPLE_SPECS.length, persistedAudioFiles: 0, undecodableCategory: failedCategory },
        summary: `GENRL=NO-GO undecodable category: ${failedCategory} (corruption self-test passed; temp audio deleted)`,
      };
    } else {
      const categories = await inspect(await readBounded(genrl, MAX_GENRL_BYTES), banks, tempRoot);
      const genrlBytes = (await stat(genrl)).size;
      result = {
        evidence: { GENRL: 'GO', bankCount: banks.size, categoryCount: categories.length, categories, genrlBytes, persistedAudioFiles: 0,
          totals: { decodedPcmBytes: categories.reduce((sum, row) => sum + row.pcmBytes, 0), validatedWavBytes: categories.reduce((sum, row) => sum + row.wavBytes, 0), validatedWavs: categories.length } },
        summary: `GENRL=GO ${categories.length} categories decoded; temp audio deleted`,
      };
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
  if (!result) throw new Error('GENRL run produced no result');
  await writeEvidence(result.evidence);
  console.log(result.summary);
}

await main();
