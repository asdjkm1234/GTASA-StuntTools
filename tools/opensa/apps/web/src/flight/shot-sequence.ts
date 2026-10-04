import type { ShotRange, ShotView } from './shot-camera';

import { SHOT_LABELS, validShotForTrack, validShotRange } from './shot-camera';

export interface ShotClip extends ShotRange {
  view: ShotView;
}
export type ShotProgram = ShotSequence | ShotView;
export interface ShotSequence {
  clips: ShotClip[];
  kind: 'sequence';
}

export function programLabel(program: ShotProgram): string {
  return program.kind === 'sequence' ? '镜头编排' : SHOT_LABELS[program.kind];
}
export function programShotAt(program: ShotProgram, seconds: number): ShotView {
  return program.kind === 'sequence' ? program.clips[sequenceIndex(program, seconds)].view : program;
}
/** Changing A/B trims or extends the edge clips without losing the overlapping cameras. */
export function resizeShotSequence(sequence: ShotSequence, range: ShotRange): ShotSequence {
  const clips = sequence.clips
    .filter((clip) => clip.end > range.start && clip.start < range.end)
    .map((clip) => ({
      end: Math.min(range.end, clip.end),
      start: Math.max(range.start, clip.start),
      view: structuredClone(clip.view),
    }));
  if (!clips.length) {
    const index = sequenceIndex(sequence, range.start);

    return { clips: [{ ...range, view: structuredClone(sequence.clips[index].view) }], kind: 'sequence' };
  }
  clips[0].start = range.start;
  clips[clips.length - 1].end = range.end;

  return { clips, kind: 'sequence' };
}
/** A contiguous capture-time edit. Exact cut frames belong to the following clip. */
export function sequenceIndex(sequence: ShotSequence, seconds: number): number {
  let index = 0;
  while (index + 1 < sequence.clips.length && seconds >= sequence.clips[index + 1].start) index++;

  return index;
}
export function validShotProgram(value: unknown, duration: number, range?: ShotRange): value is ShotProgram {
  return validShotSequence(value, duration, range) || validShotForTrack(value as ShotView, duration);
}

export function validShotSequence(value: unknown, duration: number, range?: ShotRange): value is ShotSequence {
  if (!value || typeof value !== 'object') return false;
  const sequence = value as Record<string, unknown>;
  if (
    sequence.kind !== 'sequence' ||
    !Array.isArray(sequence.clips) ||
    !sequence.clips.length ||
    sequence.clips.length > 64
  )
    return false;
  let previous: null | number = null;
  for (const item of sequence.clips as unknown[]) {
    if (!item || typeof item !== 'object') return false;
    const clip = item as ShotClip;
    if (
      !validShotRange(clip, duration) ||
      !validShotForTrack(clip.view, duration) ||
      (previous !== null && Math.abs(clip.start - previous) > 1e-6)
    )
      return false;
    previous = clip.end;
  }
  const clips = sequence.clips as ShotClip[];

  return (
    !range ||
    (validShotRange(range, duration) &&
      Math.abs(clips[0].start - range.start) < 1e-6 &&
      Math.abs(clips[clips.length - 1].end - range.end) < 1e-6)
  );
}
