/**
 * A game "mod" (plan 039): a self-contained feature layered over the vanilla pipeline, the way the
 * source community mods layer over SA (vegetation wind, PS2 trails, traffic-light cycling, …).
 *
 * NB on layering: `game/mods/**` is — together with `game/adapters/**` — allowed to import
 * renderware. Mods are GTA-specific by nature (they patch world materials and read object defs),
 * so hiding renderware types behind duplicate game-level interfaces would add indirection for no
 * generality. The engine core (`game/**` elsewhere) stays renderware-free.
 *
 * Wiring: **currently none.** `game.installMod(mod)` registered the per-frame `update` and the world
 * adapter took the mods via its config; both the installer (`game.ts`) and the `decoratePart` cell-build
 * hook died with the three renderer (074/13 C2). The interface is kept as the declared extension point —
 * re-wiring it on the engine host is a future plan, not an oversight.
 */
export interface WorldMod {
  name: string;
  /** Per-frame update — drive the mod's shader uniforms. */
  update?(context: WorldModUpdateContext): void;
}

/** Per-frame context for {@link WorldMod.update}. */
export interface WorldModUpdateContext {
  /** In-game time of day in fractional hours (0–24). */
  hours: number;
  /** Wall-clock seconds (monotonic) — for animation clocks. */
  seconds: number;
}
