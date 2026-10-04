/**
 * The whole surface between the two processes. Types only — both sides import this file, neither imports
 * the other.
 */
import type { VerdictReport } from '@opensa/validation';

export interface ConverterApi {
  readonly convert: (request: ConvertRequest) => Promise<ConvertResult>;
  readonly onConvertLine: (listener: (line: ConvertLine) => void) => () => void;
  readonly openFolder: (path: string) => Promise<void>;
  readonly openTutorial: () => void;
  readonly pickFolder: (kind: FolderKind) => Promise<string | undefined>;
  readonly quit: () => void;
  readonly validateCars: (gamePath: string, carsPath: string) => Promise<VerdictReport>;
  readonly validateGame: (gamePath: string) => Promise<VerdictReport>;
  readonly validateOut: (gamePath: string, outPath: string) => Promise<VerdictReport>;
}

/** One line the tool printed. The tool's own output IS the progress — no percentage is invented. */
export interface ConvertLine {
  readonly stream: 'stderr' | 'stdout';
  readonly text: string;
}

export interface ConvertRequest {
  readonly carsPath: string;
  readonly gamePath: string;
  readonly outPath: string;
}

export interface ConvertResult {
  /** The child's exit code; anything but 0 means the tool refused or failed, and the log says why. */
  readonly code: number;
  /** Wall-clock of the whole run, spawn to exit — the figure this app was designed around. */
  readonly ms: number;
  readonly outPath: string;
}

export type FolderKind = 'cars' | 'game' | 'out';

export const IPC = {
  convert: 'convert:run',
  convertLine: 'convert:line',
  openFolder: 'folder:open',
  openTutorial: 'tutorial:open',
  pickFolder: 'folder:pick',
  quit: 'app:quit',
  validateCars: 'validate:cars',
  validateGame: 'validate:game',
  validateOut: 'validate:out',
} as const;
