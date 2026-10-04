import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SA_FINGERPRINT } from '../asi/sdk/gen/sa-fingerprint';

type Verdict = 'blocked' | 'capturable' | 'derivable';

export interface ProposedAnchor {
  readonly address: number;
  readonly bytes: readonly number[];
  readonly fileOffset: number;
  readonly name: string;
}

interface AnchorResult extends ProposedAnchor {
  readonly actualBytes: readonly number[];
  readonly matches: boolean;
}

interface SignalEvidence {
  readonly anchor: ProposedAnchor;
  readonly candidateOffset?: number;
  readonly pointerChase: readonly string[];
  readonly rationale: string;
  readonly saneRange: { readonly maximum: number; readonly minimum: number; readonly unit: string };
  readonly verdict: Verdict;
}

interface CorruptAnchorFixture {
  readonly address: number;
  readonly expectedBytes: readonly number[];
  readonly name: string;
}

export const PROPOSED_ANCHORS: readonly ProposedAnchor[] = [
  {
    address: 0x56e0d0,
    bytes: [0x8b, 0x44, 0x24, 0x04, 0x85, 0xc0, 0x7d, 0x07],
    fileOffset: 0x16d4d0,
    name: 'FindPlayerVehicle.entry',
  },
  {
    address: 0x4f4cb0,
    bytes: [0x8a, 0x81, 0xb4, 0x04, 0x00, 0x00, 0xc3],
    fileOffset: 0x0f40b0,
    name: 'CVehicle.currentGear.getter',
  },
  {
    address: 0x6b2dee,
    bytes: [0xd9, 0x9e, 0xbc, 0x04, 0x00, 0x00],
    fileOffset: 0x2b21ee,
    name: 'CAutomobile.wheelSpinForAudio.store',
  },
  {
    address: 0x4f4cc0,
    bytes: [0xd9, 0x81, 0x9c, 0x04, 0x00, 0x00, 0xc3],
    fileOffset: 0x0f40c0,
    name: 'CVehicle.gasPedal.getter',
  },
  {
    address: 0x5435c0,
    bytes: [0x83, 0xec, 0x40, 0x53, 0x55, 0x56, 0x8b, 0xf1],
    fileOffset: 0x1429c0,
    name: 'CPhysical.ApplyCollision.entry',
  },
] as const;

class GateError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'GateError';
  }
}

export function resolveGameExe(gameDirectory?: string): string {
  return resolve(gameDirectory ?? '../../GTA San Andreas', 'gta_sa.exe');
}

export function validateAnchor(executable: string, input: unknown): AnchorResult {
  const fixture = parseCorruptAnchor(input);
  const bytes = readFileSync(executable);
  const anchor: ProposedAnchor = {
    address: fixture.address,
    bytes: fixture.expectedBytes,
    fileOffset: fixture.address - 0x400c00,
    name: fixture.name,
  };
  const result = checkAnchor(bytes, anchor);
  if (!result.matches) {
    throw new GateError(`byte-anchor-mismatch: ${anchor.name}`, 'byte-anchor-mismatch');
  }

  return result;
}

export function validateExecutable(executable: string, anchors: readonly ProposedAnchor[]): {
  readonly anchors: readonly AnchorResult[];
  readonly fingerprint: { readonly sha1: string; readonly size: number };
} {
  const bytes = readFileSync(executable);
  const fingerprint = {
    sha1: createHash('sha1').update(bytes).digest('hex'),
    size: bytes.byteLength,
  };
  if (fingerprint.size !== SA_FINGERPRINT.exeSize || fingerprint.sha1 !== SA_FINGERPRINT.sha1) {
    throw new GateError(
      `exe-fingerprint-mismatch: expected ${SA_FINGERPRINT.exeSize}/${SA_FINGERPRINT.sha1}, ` +
        `got ${fingerprint.size}/${fingerprint.sha1}`,
      'exe-fingerprint-mismatch',
    );
  }
  const results = [...SA_FINGERPRINT.anchors.map((anchor) => checkFileAnchor(bytes, anchor)), ...anchors.map((anchor) => checkAnchor(bytes, anchor))];
  const mismatch = results.find((anchor) => !anchor.matches);
  if (mismatch !== undefined) {
    throw new GateError(`byte-anchor-mismatch: ${mismatch.name}`, 'byte-anchor-mismatch');
  }

  return { anchors: results, fingerprint };
}

const SIGNALS: Readonly<Record<string, SignalEvidence>> = {
  collisionHook: {
    anchor: PROPOSED_ANCHORS[4],
    pointerChase: ['CPhysical::ApplyCollision(this, entity, colPoint, damageIntensity)', 'filter this against FindPlayerVehicle result'],
    rationale: 'Entry bytes support an observation hook, but this spike installs no hook and writes no process memory.',
    saneRange: { maximum: 1_000_000_000, minimum: 0, unit: 'damage-intensity' },
    verdict: 'capturable',
  },
  gear: {
    anchor: PROPOSED_ANCHORS[1],
    candidateOffset: 0x4b4,
    pointerChase: ['call FindPlayerVehicle(-1, false) at 0x56E0D0', 'CVehicle* return', 'read uint8 at vehicle+0x4B4'],
    rationale: 'The getter instruction embeds +0x4B4; the field can be sampled read-only after the existing recorder route.',
    saneRange: { maximum: 10, minimum: 0, unit: 'gear-index' },
    verdict: 'capturable',
  },
  load: {
    anchor: PROPOSED_ANCHORS[3],
    candidateOffset: 0x49c,
    pointerChase: ['call FindPlayerVehicle(-1, false) at 0x56E0D0', 'CVehicle* return', 'read float at vehicle+0x49C'],
    rationale: 'The anchored field is gas-pedal input, not measured engine load; load may only be derived and must be labelled as such.',
    saneRange: { maximum: 1, minimum: -1, unit: 'normalized-pedal' },
    verdict: 'derivable',
  },
  rev: {
    anchor: PROPOSED_ANCHORS[2],
    candidateOffset: 0x4bc,
    pointerChase: ['call FindPlayerVehicle(-1, false) at 0x56E0D0', 'CVehicle* return', 'read float at vehicle+0x4BC'],
    rationale: 'The anchored field is wheel-spin-for-audio, not verified engine RPM; a rev signal remains blocked rather than relabelled.',
    saneRange: { maximum: 10, minimum: 0, unit: 'unverified-audio-wheel-spin' },
    verdict: 'blocked',
  },
};

function checkAnchor(executable: Buffer, anchor: ProposedAnchor): AnchorResult {
  const actualBytes = [...executable.subarray(anchor.fileOffset, anchor.fileOffset + anchor.bytes.length)];
  return { ...anchor, actualBytes, matches: actualBytes.every((byte, index) => byte === anchor.bytes[index]) };
}

function checkFileAnchor(executable: Buffer, anchor: { readonly bytes: readonly number[]; readonly fileOffset: number; readonly name: string }): AnchorResult {
  return checkAnchor(executable, { address: anchor.fileOffset + 0x400c00, ...anchor });
}

function parseCorruptAnchor(input: unknown): CorruptAnchorFixture {
  if (typeof input !== 'object' || input === null || !('name' in input) || !('address' in input) || !('expectedBytes' in input)) {
    throw new GateError('invalid-anchor-fixture', 'invalid-anchor-fixture');
  }
  const { address, expectedBytes, name } = input;
  if (typeof name !== 'string' || typeof address !== 'number' || !Array.isArray(expectedBytes) || !expectedBytes.every((byte) => typeof byte === 'number')) {
    throw new GateError('invalid-anchor-fixture', 'invalid-anchor-fixture');
  }
  return { address, expectedBytes, name };
}

function gameArgument(): string | undefined {
  const index = process.argv.indexOf('--game');
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(): void {
  const executable = resolveGameExe(gameArgument());
  if (!existsSync(executable)) {
    console.error(`BLOCKED: gta_sa.exe is missing at ${executable}`);
    process.exitCode = 2;
    return;
  }
  const bytes = readFileSync(executable);
  const fingerprint = { sha1: createHash('sha1').update(bytes).digest('hex'), size: bytes.byteLength };
  const anchors = PROPOSED_ANCHORS.map((anchor) => checkAnchor(bytes, anchor));
  const fingerprintMatches = fingerprint.size === SA_FINGERPRINT.exeSize && fingerprint.sha1 === SA_FINGERPRINT.sha1;
  const anchorsMatch = anchors.every((anchor) => anchor.matches);
  const reason = fingerprintMatches ? (anchorsMatch ? 'rev-address-semantics-unverified' : 'byte-anchor-mismatch') : 'exe-fingerprint-mismatch';
  const artifact = {
    SIGNALS: fingerprintMatches && anchorsMatch ? 'PARTIAL' : 'NO-GO',
    anchors,
    executable,
    fingerprint: { actual: fingerprint, expected: { sha1: SA_FINGERPRINT.sha1, size: SA_FINGERPRINT.exeSize }, matches: fingerprintMatches },
    methodology: 'Read-only disk validation. gta-reversed and Plugin-SDK are route references, not verified addresses; local bytes are the referee. No game process was launched or modified.',
    reason,
    signals: SIGNALS,
  };
  const evidence = resolve('../../.omo/evidence/gate-G3-flight-analysis-remediation-and-worktree-cleanup.json');
  mkdirSync(dirname(evidence), { recursive: true });
  writeFileSync(evidence, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`${artifact.SIGNALS}: ${reason}; evidence=${evidence}`);
  if (!fingerprintMatches || !anchorsMatch) {
    console.error(`${reason}: refusing a successful gate result`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  run();
}
