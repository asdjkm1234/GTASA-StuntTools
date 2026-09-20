import type { VerdictReport } from '@opensa/validation';

import { useCallback, useEffect, useState } from 'react';

import type { ConvertLine, ConvertResult, FolderKind } from '../shared/ipc';

import { converter } from './converter';

/** A printed line plus the order it arrived in — the log is append-only, so that order is its identity. */
export interface LoggedLine extends ConvertLine {
  readonly id: number;
}

export interface Wizard {
  readonly busy: boolean;
  readonly canConvert: boolean;
  readonly cars: Choice;
  readonly convert: () => Promise<void>;
  readonly game: Choice;
  readonly lines: readonly LoggedLine[];
  readonly openOut: () => void;
  readonly out: Choice;
  readonly pick: (kind: FolderKind) => Promise<void>;
  readonly quit: () => void;
  readonly result: ConvertResult | undefined;
}

interface Choice {
  readonly path?: string;
  readonly report?: VerdictReport;
}

const blocked = (choice: Choice): boolean => choice.report?.level === 'error';
const settled = (choice: Choice): boolean => choice.path !== undefined && !blocked(choice);

export function useWizard(): Wizard {
  const [game, setGame] = useState<Choice>({});
  const [cars, setCars] = useState<Choice>({});
  const [out, setOut] = useState<Choice>({});
  const [lines, setLines] = useState<readonly LoggedLine[]>([]);
  const [result, setResult] = useState<ConvertResult | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(
    () => converter.onConvertLine((line) => setLines((previous) => [...previous, { ...line, id: previous.length }])),
    [],
  );

  // A new game folder invalidates what the other two were judged against — the coverage was measured
  // against THIS game's cutscene slots, and the output was refused for being THIS game's folder.
  const pick = useCallback(
    async (kind: FolderKind): Promise<void> => {
      const path = await converter.pickFolder(kind);

      if (!path) {
        return;
      }

      setBusy(true);

      try {
        if (kind === 'game') {
          setGame({ path, report: await converter.validateGame(path) });
          setCars({});
          setOut({});
        } else if (kind === 'cars' && game.path) {
          setCars({ path, report: await converter.validateCars(game.path, path) });
        } else if (kind === 'out' && game.path) {
          setOut({ path, report: await converter.validateOut(game.path, path) });
        }
      } finally {
        setBusy(false);
      }
    },
    [game.path],
  );

  const canConvert = !busy && settled(game) && settled(cars) && settled(out);

  const convert = useCallback(async (): Promise<void> => {
    if (!game.path || !cars.path || !out.path) {
      return;
    }

    setBusy(true);
    setLines([]);
    setResult(undefined);

    try {
      setResult(await converter.convert({ carsPath: cars.path, gamePath: game.path, outPath: out.path }));
    } finally {
      setBusy(false);
    }
  }, [cars.path, game.path, out.path]);

  const quit = useCallback(() => converter.quit(), []);

  const openOut = useCallback(() => {
    if (out.path) {
      void converter.openFolder(out.path);
    }
  }, [out.path]);

  return { busy, canConvert, cars, convert, game, lines, openOut, out, pick, quit, result };
}
