/**
 * The build TARGET — which host an artifact is being built FOR. Two values, and neither is a mode of the
 * other: `sa` is the real game as we ship to it (OLA + FLA + our own `perfect-map.asi` — see
 * `docs/gta-sa-original/reference-install.md`), `opensa` is our own engine, own formats, own streaming.
 * **Stock SA is not a target** (user's call 2026-08-08); a build that lands on one is a build-time REPORT,
 * never a cap that rations the host we do ship to.
 *
 * The target selects every knob whose right value is a fact about the HOST rather than about the source
 * data — limits, particle policy, procobj density. It is a build INPUT rather than a flag an operator
 * remembers: a guard left on a stage both targets share silently rations the target that does not have the
 * limit, and the build still succeeds (`docs/restrictions/sa-target.md`).
 */
export const BUILD_TARGETS = ['sa', 'opensa'] as const;

export type BuildTarget = (typeof BUILD_TARGETS)[number];

/**
 * Parse a `--target` value; `undefined` passes through so each caller resolves its own default. A typo has to
 * fail LOUDLY — a silently ignored target builds against the wrong host's ceilings, and nothing downstream can
 * tell that from a build nobody asked for.
 */
export function parseBuildTarget(value: string | undefined): BuildTarget | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!BUILD_TARGETS.includes(value as BuildTarget)) {
    throw new Error(`--target must be one of: ${BUILD_TARGETS.join(' | ')} (got '${value}')`);
  }

  return value as BuildTarget;
}
