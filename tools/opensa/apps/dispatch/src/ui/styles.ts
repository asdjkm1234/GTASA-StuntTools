/**
 * The console's look, as one style table — the pattern the other OpenSA apps use (`viewer-styles.ts`,
 * `debug-styles.ts`). Dark, flat and dense on purpose: an operations surface is read at a glance for eight
 * hours, so contrast goes to the data and nothing else competes with the map.
 *
 * **What each value MEANS is [`apps/dispatch/DESIGN.md`](../../DESIGN.md)** — the ramp's step roles, the
 * layering rule, why state colour may not live here. This file is what components import; that one is why.
 */
import type { CSSProperties } from 'react';

/**
 * The smallest a control may be where a FINGER is the pointer, CSS px. Not ours and not a feel: WCAG 2.2's
 * enhanced target-size criterion (2.5.5) is 44×44 CSS px, Apple's HIG says 44 pt and Material says 48 dp —
 * 44 is the number all three agree is enough. Below it a control is not "small", it is one an operator
 * misses while driving a shift ([restrictions/cross-platform-surface.md](../../../../docs/restrictions/cross-platform-surface.md)).
 */
export const TOUCH_TARGET = 44;

/**
 * The neutral ramp, dark-first, with one declared role per step.
 *
 * The step roles are [Radix Colors'](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale):
 * 1-2 backgrounds, 3-5 component backgrounds by state, 6-8 borders by strength, 11-12 text. Before this the
 * console had seven flat colours and no rule for which to use where, so every component picked whatever
 * looked close and the surfaces stopped agreeing with each other.
 *
 * **Depth is value, not outline** (the dark-theme layering model IBM Carbon states explicitly: each added
 * layer is one step lighter). The world is step 1, docked surfaces are step 2, and anything floating OVER
 * the map is step 3 — which is what makes it read as being on top, rather than a panel with a border.
 */
export const RAMP = {
  /** 1 — the world, and what the map draws onto. */
  bg: 'var(--os-bg)',
  /** 6 — separators inside one surface. */
  line: 'var(--os-line)',
  /** 7 — the edge of an interactive component. */
  lineStrong: 'var(--os-line-strong)',
  /** 8 — strong border, and the focus ring. */
  ring: 'var(--os-ring)',
  /** 2 — docked surfaces: the side panels and the three bars. */
  surface: 'var(--os-surface)',
  /** 4 — hover. */
  surfaceHover: 'var(--os-surface-hover)',
  /** 5 — active or selected. */
  surfaceOn: 'var(--os-surface-on)',
  /** 3 — components: rows, inputs, and everything floating over the map. */
  surfaceRaised: 'var(--os-surface-raised)',
  /** 12 — primary text. */
  text: 'var(--os-text)',
  /** 11 — secondary text. */
  textMuted: 'var(--os-text-muted)',
} as const;

/**
 * The accent, and it means exactly ONE thing: the operator's own mark — selection, focus, live, the primary
 * action. It used to be on primary buttons, the fps readout, every active tab, the inventory panel's border
 * and the key sheet at once, which is how an accent stops marking anything.
 *
 * **State colour is not here and may not be added here.** A unit's status and a call's priority come from
 * `src/map/beacons.ts` → `SET_COLORS`, the one table the beacons, the 2D overlay, the radar and the lists
 * all read — which is why a chip in the queue cannot drift from the pillar on the map.
 */
export const ACCENT = {
  /** The fill behind a primary or selected control. */
  bg: 'var(--os-accent-bg)',
  /** Its edge. */
  border: 'var(--os-accent-border)',
  /** Solid — the ring, the rail, the dot. */
  solid: 'var(--os-accent-solid)',
  /** Text on a dark fill: the solid is too hot for a glyph at 11 px. */
  text: 'var(--os-accent-text)',
} as const;

/**
 * The two surfaces that are NOT neutral and NOT the accent: a warning the console is standing in, and a
 * state it is showing the past in. Both are deliberately loud, and both are here rather than inline so
 * there is one place to answer "what does the console look like when something is wrong".
 *
 * This is the whole of it. A UNIT's status or a CALL's priority is not a semantic colour and does not
 * belong here — it comes from `src/map/beacons.ts` → `SET_COLORS`, the table the map itself draws from.
 */
export const SEMANTIC = {
  dangerBg: 'var(--os-danger-bg)',
  dangerText: 'var(--os-danger-text)',
  warnBg: 'var(--os-warn-bg)',
  warnBorder: 'var(--os-warn-border)',
  warnSolid: 'var(--os-warn-solid)',
  warnText: 'var(--os-warn-text)',
} as const;

/** 4-based, and nothing between the steps. */
export const SPACE = { lg: 16, md: 12, sm: 8, xl: 24, xs: 4, xxs: 2 } as const;

/** Three radii. There were eight. */
/**
 * Three radii, and since 2026-08-26 they are nearly zero.
 *
 * They were 4 / 999 / 8 — a rounded control, a fully round pill and a rounded panel — which is the shape
 * language of a web dashboard, not of an instrument. Nothing in a dispatch room has a rounded corner, and
 * the user's verdict on the old set was blunt and correct. `2` on a control is the smallest radius that
 * still reads as deliberate rather than as an unstyled box; a panel and a tag are square.
 *
 * **Since 2026-08-30 the values are the THEME's** (`ConsoleTheme.shape.radius`, 201/7-10) — the numbers
 * above are what every preset shipping today declares, and a preset that wants a different corner says so
 * as data rather than by forking this table.
 */
export const RADIUS = {
  control: 'var(--os-radius-control)',
  pill: 'var(--os-radius-pill)',
  surface: 'var(--os-radius-surface)',
} as const;

/**
 * The type scale. `input` is what a finger types into; the rest is what it reads.
 *
 * **`caption` and `body` are the theme's density lever** (201/7-10) and come through variables; the rest are
 * fixed here on purpose. `input` at 15 px is the floor below which iOS zooms the page on focus, `title` is
 * not a row, and `bodyTouch`/`micro` answer the pointer rather than the skin — none of them is a density
 * question, so none of them moves when a denser preset is chosen.
 */
export const TEXT = {
  body: 'var(--os-text-body)',
  bodyTouch: 13,
  caption: 'var(--os-text-caption)',
  input: 15,
  micro: 10,
  title: 17,
} as const;

/**
 * Depth for the two things that float.
 *
 * The soft 16-px drop shadow that used to be here is what made the panels read as CARDS. It is a hard,
 * tight edge now: an instrument's panel is bolted over the display, it does not hover above it. The shadow
 * still exists — a panel over a moving map needs SOMETHING to separate it — but at 2 px and near-opaque it
 * reads as a bevel rather than as elevation.
 */
export const SHADOW = {
  float: 'var(--os-shadow-float)',
  modal: 'var(--os-shadow-modal)',
} as const;

/** A tap has to be acknowledged on a device that may be a frame behind; nothing else animates. */
const PRESS = 'background-color 120ms ease-out, border-color 120ms ease-out';

/**
 * The names the rest of the app used before the ramp existed. Kept as an alias rather than renamed across
 * fourteen components: the values move, the call sites do not.
 */
export const COLORS = {
  accent: ACCENT.solid,
  border: RAMP.lineStrong,
  danger: 'var(--os-danger)',
  muted: RAMP.textMuted,
  panel: RAMP.surface,
  panelRaised: RAMP.surfaceRaised,
  text: RAMP.text,
} as const;

const MONO = 'var(--os-font-mono)';
/** Every changing number is tabular, or the row it sits in shifts as it counts. */
const NUM = 'tabular-nums' as const;
/** What floats over the map: step 3, nearly opaque, lifted by a shadow instead of ringed by a border. */
const FLOATING = {
  background: 'var(--os-float-bg)',
  border: `1px solid ${RAMP.lineStrong}`,
  boxShadow: SHADOW.float,
} as const;

export const styles = {
  /**
   * Desk: three columns.
   *
   * **`minmax(0, …)` on every flexible track, never a bare `1fr`.** A `1fr` track keeps `min-width: auto`,
   * so it refuses to shrink below the widest thing in ANY row of that column — one over-wide row then
   * widens the whole grid, and since the map cell is in that column the map is widened with it. Measured
   * 2026-08-25 at 360 CSS px: the top bar's content came to 403 px, the single column became 403, and every
   * control anchored to the map's RIGHT edge — the whole turn/tilt/zoom cluster's right-hand column — sat
   * 43 px past the screen with no way to scroll to it. Nothing clipped visibly and nothing warned.
   */
  /**
   * The band that says an agent is driving this page (phone-console plan 002).
   *
   * Top-centre and `pointerEvents: none`: the operator's own cluster is top-LEFT and the radar top-RIGHT, so
   * a centred line is the one place across the width that belongs to neither, and passing every pointer
   * through means it can overlap one on a narrow screen without ever eating a tap. It exists only while a
   * panel is answering, which is exactly when nobody is typing in the search box.
   */
  agentBand: {
    background: SEMANTIC.warnBg,
    border: `1px solid ${SEMANTIC.warnBorder}`,
    borderRadius: RADIUS.control,
    color: SEMANTIC.warnText,
    fontSize: TEXT.caption,
    left: SPACE.sm,
    margin: '0 auto',
    maxWidth: 460,
    overflow: 'hidden',
    padding: '5px 10px',
    pointerEvents: 'none',
    position: 'absolute',
    right: SPACE.sm,
    textAlign: 'center',
    textOverflow: 'ellipsis',
    top: SPACE.sm,
    whiteSpace: 'nowrap',
    width: 'fit-content',
    zIndex: 5,
  },
  /** Released: the accent, because this is the one state the operator is WAITING for rather than warned by. */
  agentBandDone: {
    background: ACCENT.bg,
    border: `1px solid ${ACCENT.border}`,
    color: ACCENT.text,
  },
  /** The panel stopped answering. Danger rather than warning: every other state is the link WORKING, and an
   *  operator holding a phone still for a link that has ended is the cost this state was added to end. */
  agentBandLost: {
    background: SEMANTIC.dangerBg,
    border: `1px solid ${COLORS.danger}`,
    color: SEMANTIC.dangerText,
  },
  /**
   * One command, as it happens (201/3-05). Under the band, `pointerEvents: none`, and never a control: a
   * notice with a dismiss button is a notice competing with the map for a finger.
   */
  agentNotice: {
    background: 'var(--os-float-bg)',
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    fontSize: TEXT.micro,
    overflow: 'hidden' as const,
    padding: '4px 9px',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  /** The half of a notice that is context rather than the sentence — quieter, and it may be the part cut. */
  agentNoticeDetail: {
    color: RAMP.textMuted,
  },
  /** A command that threw on this page. The operator sees the failure the agent is being handed. */
  agentNoticeFailed: {
    background: SEMANTIC.dangerBg,
    border: `1px solid ${COLORS.danger}`,
    borderRadius: RADIUS.control,
    color: SEMANTIC.dangerText,
    fontSize: TEXT.micro,
    overflow: 'hidden' as const,
    padding: '4px 9px',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  /** The stack. Centred like the band it hangs under, and bounded so a long detail cannot reach either
   *  corner cluster — 360 CSS px is the screen this is judged at. */
  agentNotices: {
    display: 'grid',
    fontFamily: MONO,
    gap: SPACE.xxs,
    justifyItems: 'center' as const,
    left: SPACE.sm,
    margin: '0 auto',
    maxWidth: 460,
    pointerEvents: 'none' as const,
    position: 'absolute' as const,
    right: SPACE.sm,
    top: 36,
    width: 'fit-content' as const,
    zIndex: 5,
  },
  app: {
    background: RAMP.bg,
    color: COLORS.text,
    display: 'grid',
    fontFamily: 'var(--os-font-sans)',
    fontSize: 12,
    // ONE column since 201/7-08. The queue and the roster used to be 300-px and 264-px tracks either side
    // of the map, which is 564 px the map did not have on a 1280-px desk — 44 % of the width spent on two
    // lists that are read in glances. They are windows over the world now, and the world is the workspace.
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateRows: '44px minmax(0, 1fr) 30px 26px',
    height: '100%',
    width: '100%',
  },
  /** Phone: one column — map fills the screen, the lists live in a sheet under it. */
  appCompact: {
    background: RAMP.bg,
    color: COLORS.text,
    display: 'grid',
    fontFamily: 'var(--os-font-sans)',
    fontSize: 12,
    gridTemplateColumns: 'minmax(0, 1fr)',
    // 48 rather than 40: the bar carries 44-px targets now, and a 40-px row makes every one of them
    // overflow its own bar. The sheet is `auto` rather than a fixed 44% because a fixed share left ~200 px
    // of black under two calls while the map — the thing the console is for — was starved to 350.
    gridTemplateRows: '48px minmax(0, 1fr) auto 34px 22px',
    height: '100%',
    width: '100%',
  },
  /** `?embed=1`: the map fills the frame the host gave it, and nothing else is drawn. */
  appEmbedded: {
    background: RAMP.bg,
    color: RAMP.text,
    fontFamily: 'var(--os-font-sans)',
    fontSize: TEXT.body,
    height: '100%',
    position: 'relative',
    width: '100%',
  },
  /**
   * A square tag. It was a fully-round pill with a translucent tint of its own colour behind it — the
   * default badge of every generated dashboard, and the thing that made these lists look like a template.
   * A tag on an instrument is a stamped rectangle.
   */
  badge: {
    borderRadius: RADIUS.pill,
    fontFamily: MONO,
    fontSize: TEXT.micro,
    fontVariantNumeric: NUM,
    fontWeight: 600,
    letterSpacing: 0.2,
    padding: '1px 5px',
  },
  button: {
    background: RAMP.surfaceRaised,
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.caption,
    padding: '4px 9px',
    transition: PRESS,
  },
  buttonPrimary: {
    background: ACCENT.bg,
    border: `1px solid ${ACCENT.border}`,
    borderRadius: RADIUS.control,
    color: ACCENT.text,
    cursor: 'pointer',
    fontSize: TEXT.caption,
    padding: '4px 9px',
    transition: PRESS,
  },
  buttonPrimaryTouch: {
    background: ACCENT.bg,
    border: `1px solid ${ACCENT.border}`,
    borderRadius: RADIUS.control,
    color: ACCENT.text,
    cursor: 'pointer',
    fontSize: TEXT.bodyTouch,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '4px 12px',
    transition: PRESS,
  },
  /** `minWidth` as well as `minHeight`: the criterion is 44 in BOTH axes, and a short label — `Fit`, `×1` —
   *  came out 40 and 33 wide while passing the height every reviewer actually checks. */
  buttonTouch: {
    background: RAMP.surfaceRaised,
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.bodyTouch,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '4px 12px',
    transition: PRESS,
  },
  // `touchAction: none` is load-bearing on a phone: without it the browser claims the drag for scrolling
  // and page-zoom before a single `pointermove` reaches the gesture layer.
  canvas: { display: 'block', height: '100%', touchAction: 'none', width: '100%' },
  canvasWrap: { minHeight: 0, overflow: 'hidden', position: 'relative' },
  degradedBanner: {
    background: SEMANTIC.warnBg,
    border: `1px solid ${SEMANTIC.warnBorder}`,
    borderRadius: RADIUS.surface,
    bottom: SPACE.sm,
    boxShadow: SHADOW.float,
    color: SEMANTIC.warnText,
    fontSize: TEXT.caption,
    maxWidth: 420,
    padding: '5px 10px',
    position: 'absolute',
    // Bottom-RIGHT since 201/7-03: the top-left corner is the operator's cluster (search, fit, follow,
    // saved views), and a banner across the top covered the search box in exactly the mode — plan mode —
    // where an operator needs it most. It is a standing state notice, not an alert that must interrupt.
    right: 10,
    zIndex: 4,
  },
  detail: {
    ...FLOATING,
    borderRadius: RADIUS.surface,
    bottom: 14,
    left: 14,
    maxWidth: 380,
    padding: '10px 12px',
    position: 'absolute',
    zIndex: 3,
  },
  detailCompact: {
    ...FLOATING,
    borderRadius: RADIUS.surface,
    bottom: 8,
    left: 8,
    padding: '9px 11px',
    position: 'absolute',
    right: 8,
    zIndex: 3,
  },
  empty: { color: RAMP.textMuted, fontStyle: 'italic', padding: '12px' },
  fill: { height: '100%', left: 0, position: 'absolute', top: 0, width: '100%' },
  inventoryButton: {
    background: ACCENT.solid,
    border: 'none',
    borderRadius: RADIUS.control,
    color: RAMP.bg,
    cursor: 'pointer',
    fontSize: TEXT.caption,
    fontWeight: 700,
    marginTop: SPACE.xxs,
    minHeight: 28,
    padding: '5px 10px',
  },
  /** Shown only when the clipboard is unavailable — a LAN dev server is not a secure context. */
  inventoryFallback: {
    background: RAMP.bg,
    border: `1px solid ${RAMP.lineStrong}`,
    color: RAMP.textMuted,
    fontFamily: MONO,
    fontSize: 9,
    height: 90,
    marginTop: 4,
    width: '100%',
  },
  /**
   * The fold control, which folded IS the panel (201/3-05). A row rather than a corner glyph: on a phone the
   * whole header has to be the target, and a 12-px chevron is the defect this repository already paid for
   * three times.
   */
  inventoryHeader: {
    alignItems: 'center',
    background: 'none',
    border: 'none',
    color: RAMP.text,
    cursor: 'pointer',
    display: 'flex',
    fontFamily: MONO,
    fontSize: TEXT.micro,
    fontVariantNumeric: NUM,
    gap: SPACE.xs,
    margin: 0,
    padding: 0,
    textAlign: 'left' as const,
    width: '100%',
  },
  /**
   * Where a FINGER is the pointer: the full 44 px, in both axes (`TOUCH_TARGET`) — and the TYPE does not
   * move with it. The restriction is about what a finger can hit, not about what it reads: at `bodyTouch`
   * this row was wider than the 240-px panel and wrapped its own summary onto two lines, which made the
   * folded panel taller than the thing it folds. Every other row here is `micro`, and the header is not the
   * one oversized element in a table of numbers.
   */
  inventoryHeaderTouch: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
  },
  /** 201/1-01. Bottom-left so it never sits under the selection panel, and narrow enough for 360 CSS px. */
  inventoryPanel: {
    ...FLOATING,
    borderRadius: RADIUS.surface,
    bottom: SPACE.sm,
    color: RAMP.text,
    display: 'grid',
    fontFamily: MONO,
    fontSize: TEXT.micro,
    fontVariantNumeric: NUM,
    gap: 3,
    left: SPACE.sm,
    maxWidth: 240,
    padding: '6px 8px',
    position: 'absolute',
    zIndex: 5,
  },
  /** Folded: the header alone, so the map keeps the corner. `width: fit-content` rather than the panel's
   *  240 — a one-line summary that still reserved a 240-px block would not have given anything back. */
  inventoryPanelFolded: {
    maxWidth: 240,
    padding: '4px 8px',
    width: 'fit-content' as const,
  },
  inventoryWarn: {
    color: SEMANTIC.warnSolid,
  },
  /** 201/7-06's key sheet. Centred over the map, because it is a modal reference rather than a tool: an
   *  operator reading it is not working the board at that second. */
  keyHelp: {
    background: 'var(--os-modal-bg)',
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.surface,
    boxShadow: SHADOW.modal,
    display: 'grid',
    gap: 7,
    left: '50%',
    maxHeight: '76%',
    maxWidth: 400,
    overflowY: 'auto' as const,
    padding: '10px 12px',
    position: 'absolute',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: '84%',
    zIndex: 6,
  },
  keyHelpHead: { alignItems: 'center', display: 'flex', fontSize: 11, gap: 8, justifyContent: 'space-between' },
  keyHelpRow: {
    background: 'transparent',
    border: `1px solid transparent`,
    borderRadius: RADIUS.control,
    color: COLORS.text,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    gap: 10,
    justifyContent: 'space-between',
    padding: '3px 6px',
    textAlign: 'left' as const,
    width: '100%',
  },
  keyHelpRowListening: {
    background: ACCENT.bg,
    border: `1px solid ${ACCENT.border}`,
    borderRadius: RADIUS.control,
    color: ACCENT.text,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 11,
    gap: 10,
    justifyContent: 'space-between',
    padding: '3px 6px',
    textAlign: 'left' as const,
    width: '100%',
  },
  keyHelpRows: { display: 'grid', gap: 1 },
  logLine: {
    borderBottom: `1px solid ${COLORS.border}`,
    color: COLORS.muted,
    fontFamily: MONO,
    fontSize: 10,
    padding: '3px 12px',
  },
  mapNav: {
    display: 'grid',
    gap: 4,
    justifyItems: 'center',
    position: 'absolute',
    right: 10,
    top: 10,
    zIndex: 3,
  },
  /** The cluster COLLAPSED on a phone: one target that says what is behind it. */
  mapNavCompact: {
    display: 'grid',
    gap: 6,
    justifyItems: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    zIndex: 3,
  },
  mapNavCompass: {
    ...FLOATING,
    borderRadius: '50%',
    cursor: 'pointer',
    lineHeight: 0,
    padding: 3,
  },
  /** 42 px with its border, which is under the criterion — the rose needs its own size where a finger
   *  presses it rather than the padding that fits a mouse. */
  mapNavCompassTouch: {
    ...FLOATING,
    alignItems: 'center',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    height: TOUCH_TARGET,
    justifyContent: 'center',
    lineHeight: 0,
    padding: 0,
    width: TOUCH_TARGET,
  },
  mapNavKey: {
    ...FLOATING,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.body,
    height: 26,
    lineHeight: '12px',
    padding: 0,
    transition: PRESS,
    width: 26,
  },
  mapNavKeyTouch: {
    ...FLOATING,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.input,
    height: TOUCH_TARGET,
    lineHeight: '15px',
    padding: 0,
    transition: PRESS,
    width: TOUCH_TARGET,
  },
  mapNavLevel: {
    ...FLOATING,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.micro,
    fontWeight: 700,
    letterSpacing: 0.5,
    padding: '3px 5px',
    transition: PRESS,
  },
  mapNavLevelTouch: {
    ...FLOATING,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.body,
    fontWeight: 700,
    letterSpacing: 0.5,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '3px 6px',
    transition: PRESS,
  },
  mapNavRow: { display: 'flex', gap: 4 },
  /** 201/7-03's operator cluster: search, saved views, fit and follow. Top-left, where every map application
   *  puts them, and clear of the selection panel and the inventory panel (both bottom-left). */
  mapTools: {
    ...FLOATING,
    borderRadius: RADIUS.surface,
    display: 'grid',
    gap: SPACE.xs + 1,
    left: SPACE.sm,
    maxWidth: 232,
    padding: SPACE.sm,
    position: 'absolute',
    top: SPACE.sm,
    zIndex: 3,
  },
  /** The cluster collapsed to its one handle on a phone (201/7-03 expanded it always, which on a 360-px
   *  screen put nine buttons and a search box over 60% of the map). */
  mapToolsHandle: {
    ...FLOATING,
    alignItems: 'center',
    borderRadius: RADIUS.surface,
    color: RAMP.text,
    cursor: 'pointer',
    display: 'flex',
    fontSize: 12,
    fontWeight: 700,
    gap: 6,
    justifyContent: 'center',
    left: 8,
    letterSpacing: 1,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '0 12px',
    position: 'absolute',
    top: 8,
    zIndex: 3,
  },
  /** One hit in the place search — a row-wide button, so the whole line is the target on a phone. */
  mapToolsHit: {
    background: 'transparent',
    border: 'none',
    borderRadius: RADIUS.control,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 11,
    padding: '3px 5px',
    textAlign: 'left' as const,
    width: '100%',
  },
  mapToolsHitTouch: {
    background: 'transparent',
    border: 'none',
    borderRadius: RADIUS.control,
    color: COLORS.text,
    cursor: 'pointer',
    fontSize: 13,
    minHeight: TOUCH_TARGET,
    padding: '3px 5px',
    textAlign: 'left' as const,
    width: '100%',
  },
  mapToolsInput: {
    background: RAMP.bg,
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    fontSize: TEXT.caption,
    padding: '4px 6px',
    width: '100%',
  },
  mapToolsInputTouch: {
    background: RAMP.bg,
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    fontSize: TEXT.input,
    minHeight: TOUCH_TARGET,
    padding: '4px 10px',
    width: '100%',
  },
  /** The live number. Monospace, so a distance that is growing does not shuffle the row it sits in. */
  measureReadout: {
    color: COLORS.text,
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  measureRow: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  /** 201/7-05's rows inside the operator cluster — they wrap rather than push the cluster past 360 px. */
  measureTools: { display: 'grid', gap: 5 },
  /** 201/7-06's on-screen controls: top-right, opposite the operator cluster and clear of both panels. */
  /**
   * 201/7-04's radar: bottom-right, the one corner nothing else claims (tools top-left, nav top-right,
   * selection and inventory bottom-left). Round, on the user's call — and the element is round too, so the
   * click target is the dial rather than a square with dead corners.
   */
  minimap: {
    borderRadius: '50%',
    bottom: 10,
    cursor: 'pointer',
    height: 132,
    position: 'absolute',
    right: 10,
    width: 132,
    zIndex: 3,
  },
  /** Phone: smaller, and clear of the sheet's grab handle. 108 px still reads at arm's length. */
  minimapCompact: {
    borderRadius: '50%',
    bottom: 8,
    cursor: 'pointer',
    height: 108,
    position: 'absolute',
    right: 8,
    width: 108,
    zIndex: 3,
  },
  mono: { fontFamily: MONO, fontVariantNumeric: NUM },
  /**
   * A list panel's body. There is one of these rather than a `panel`/`panelRight` pair: the side borders
   * those two carried said which EDGE of the desk the panel was docked to, and since 201/7-08 neither is
   * docked — the window frame around them draws the border now.
   */
  panel: {
    background: 'transparent',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
  },
  /** The phone sheet's tab strip. */
  /**
   * A slider a finger can catch.
   *
   * The thumb's own size is the browser's and cannot be reached from an inline style — but a range input
   * takes the press anywhere in its box and drags from there, so the box is the target that counts. Both of
   * this console's sliders measured 16 px tall (the world dial and the shift scrub), which is a third of the
   * criterion on the two controls an operator sweeps rather than taps.
   */
  rangeTouch: {
    cursor: 'pointer',
    height: TOUCH_TARGET,
  },
  /**
   * A queue row. The 3 px transparent left border is the RAIL a call's priority is painted into
   * (`rowRail`) — priority is encoded as position, text and colour together, so none of the three has to be
   * read alone (DESIGN.md, "Priority is encoded three ways").
   */
  row: {
    borderBottom: `1px solid ${RAMP.line}`,
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: 'var(--os-row-padding)',
    transition: PRESS,
  },
  /** The age, the count, anything that ticks: tabular, or the row shifts under the eye reading it. */
  rowMeta: { color: RAMP.textMuted, fontVariantNumeric: NUM },
  /** Selected. An inset ring rather than a left border: the left edge is the priority rail's, and a
   *  selection that overwrote it would hide the one thing the row is scanned for. */
  rowSelected: {
    background: RAMP.surfaceOn,
    boxShadow: `inset 0 0 0 1px ${ACCENT.border}`,
  },
  /** Touch: the same row, at a height a finger can land on without hitting its neighbour. */
  rowTouch: {
    borderBottom: `1px solid ${RAMP.line}`,
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minHeight: TOUCH_TARGET,
    padding: '10px 12px',
    transition: PRESS,
  },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  /** The skin switcher, and any other native picker. Same shape as `button` so the bar reads as one row. */
  select: {
    background: RAMP.surfaceRaised,
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.caption,
    padding: '4px 6px',
  },
  selectTouch: {
    background: RAMP.surfaceRaised,
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.text,
    cursor: 'pointer',
    fontSize: TEXT.bodyTouch,
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    padding: '4px 8px',
  },
  /** The phone sheet: as tall as the list needs, and never more than this share of the screen. */
  sheet: { display: 'flex', flexDirection: 'column' as const, maxHeight: '44vh', minHeight: 0 },
  sheetTab: {
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid transparent`,
    color: RAMP.textMuted,
    cursor: 'pointer',
    flex: 1,
    fontSize: TEXT.caption,
    fontVariantNumeric: NUM,
    fontWeight: 700,
    letterSpacing: 1,
    padding: '9px 0',
    transition: PRESS,
  },
  sheetTabActive: {
    borderBottom: `2px solid ${COLORS.accent}`,
    color: COLORS.text,
  },
  sheetTabs: {
    background: RAMP.surface,
    borderTop: `1px solid ${RAMP.line}`,
    display: 'flex',
  },
  sheetTabTouch: {
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid transparent`,
    color: RAMP.textMuted,
    cursor: 'pointer',
    flex: 1,
    fontSize: TEXT.bodyTouch,
    fontVariantNumeric: NUM,
    fontWeight: 700,
    letterSpacing: 1,
    minHeight: TOUCH_TARGET,
    padding: '9px 0',
    transition: PRESS,
  },
  statusBar: {
    alignItems: 'center',
    background: RAMP.surface,
    borderTop: `1px solid ${RAMP.line}`,
    color: RAMP.textMuted,
    display: 'flex',
    fontFamily: MONO,
    fontSize: TEXT.micro,
    fontVariantNumeric: NUM,
    gap: SPACE.lg,
    gridColumn: '1 / -1',
    // The row is bounded by the grid now, so anything too long has to be cut here rather than push the
    // column wider — which is how the map ended up wider than the screen.
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 12px',
    whiteSpace: 'nowrap' as const,
  },
  /** One field of the status bar that can be arbitrarily long. */
  statusEllipsis: { minWidth: 0, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const },
  /** A row's own state — quieter than the call-sign beside it, and never competing with the priority rail. */
  statusTag: {
    color: RAMP.textMuted,
    fontSize: TEXT.micro,
    fontWeight: 700,
    letterSpacing: 0.6,
  },
  /** The shift timeline strip (201/8-03). Sits above the status bar, full width. */
  /**
   * The status tally in a panel's header — `AVAILABLE 4 · EN ROUTE 2 · ON SCENE 1`.
   *
   * Taken from SonoranCAD, which is the only console in the field that puts the counts where the legend
   * would go, so one line answers both "what does this colour mean" and "how is the shift doing". The
   * numbers and the swatches come from `map/beacons.ts` → `SET_COLORS`, the same table the pillars on the
   * map are drawn from — a legend that could disagree with the map would be worse than none.
   */
  tally: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    fontFamily: MONO,
    fontSize: TEXT.micro,
    fontVariantNumeric: NUM,
    fontWeight: 400,
    gap: SPACE.sm,
    letterSpacing: 0,
    marginLeft: 'auto',
    minWidth: 0,
    overflow: 'hidden',
    textTransform: 'none',
  },
  /**
   * The legend swatch beside a tally count, and it is ROUND on purpose while the console is square.
   *
   * A 6-px dot is a MARK, not a surface: it stands for the pillar the engine draws on the map, so its shape
   * answers to the symbology rather than to the skin — which is the same reason its colour comes from
   * `SET_COLORS` and not from the theme. Its radius therefore does not come from `RADIUS`, and it lives
   * here rather than inline in `status-tally.tsx` so the theme guard can see one deliberate exception in
   * the token table instead of a raw value in a component.
   */
  tallyDot: { borderRadius: '50%', height: 6, width: 6 },
  tallyItem: { alignItems: 'center', display: 'flex', gap: 4 },
  timeline: {
    alignItems: 'center',
    background: RAMP.surface,
    borderTop: `1px solid ${RAMP.line}`,
    display: 'flex',
    fontVariantNumeric: NUM,
    gap: SPACE.sm,
    gridColumn: '1 / -1',
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 12px',
  },
  /** The scrub track itself — it takes what the row has left. */
  timelineRange: {
    flex: 1,
    minWidth: 60,
  },
  /** REPLAY, shown while the console is NOT live. Deliberately loud: the whole screen is showing the past,
   *  and an operator who misses that is reading an old picture as the current one. */
  timelineReplay: {
    background: SEMANTIC.dangerBg,
    borderRadius: RADIUS.pill,
    color: SEMANTIC.dangerText,
    fontFamily: MONO,
    fontSize: TEXT.micro,
    letterSpacing: 0.6,
    padding: '2px 6px',
  },
  /** A two-state control that is a BUTTON, not a checkbox: a native checkbox renders 13x13 and no inline
   *  style reaches it, so on a phone the console's one board-wide switch was a third of a finger. */
  toggle: {
    alignItems: 'center',
    background: RAMP.surfaceRaised,
    border: `1px solid ${RAMP.lineStrong}`,
    borderRadius: RADIUS.control,
    color: RAMP.textMuted,
    cursor: 'pointer',
    display: 'flex',
    fontSize: TEXT.caption,
    gap: SPACE.xs + 2,
    padding: '4px 9px',
    transition: PRESS,
  },
  toggleOn: {
    alignItems: 'center',
    background: ACCENT.bg,
    border: `1px solid ${ACCENT.border}`,
    borderRadius: RADIUS.control,
    color: ACCENT.text,
    cursor: 'pointer',
    display: 'flex',
    fontSize: TEXT.caption,
    gap: SPACE.xs + 2,
    padding: '4px 9px',
    transition: PRESS,
  },
  topBar: {
    alignItems: 'center',
    background: RAMP.surface,
    borderBottom: `1px solid ${RAMP.line}`,
    display: 'flex',
    gap: SPACE.lg,
    gridColumn: '1 / -1',
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 14px',
  },
  /** Phone: the same bar with the gaps a 360-px screen can pay for. */
  topBarCompact: {
    alignItems: 'center',
    background: RAMP.surface,
    borderBottom: `1px solid ${RAMP.line}`,
    display: 'flex',
    gap: SPACE.sm,
    gridColumn: '1 / -1',
    minWidth: 0,
    overflow: 'hidden',
    padding: '0 8px',
  },
  /**
   * The unit's callsign, as the thing the eye lands on.
   *
   * SonoranCAD's rows are read by their unit number and not by the officer's name, and the reason is
   * mechanical rather than aesthetic: a name truncates and a callsign does not, so at 360 px the pill is
   * still whole when everything beside it has become an ellipsis. The colour is the unit's STATUS, from
   * the map's own table.
   */
  /**
   * The callsign, as a SOLID block of its status colour with dark ink on it — not a translucent tint of it.
   * A tinted pill is the shadcn badge; a solid stamp is what a status light looks like, and it is also the
   * higher contrast of the two.
   */
  unitPill: {
    borderRadius: RADIUS.pill,
    color: 'var(--os-on-status)',
    fontFamily: MONO,
    fontSize: TEXT.caption,
    fontVariantNumeric: NUM,
    fontWeight: 600,
    letterSpacing: 0.2,
    padding: '1px 6px',
    whiteSpace: 'nowrap',
  },
  /** The scrolling body of a floating window — the panel itself lives in here. */
  windowBody: { display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
  /**
   * A floating panel over the map (201/7-08).
   *
   * `position: absolute` inside `canvasWrap`, which is why every rect in `window-frame.ts` is relative to
   * the map rather than to the page: the map is the coordinate space the operator is arranging things in.
   */
  windowFrame: {
    ...FLOATING,
    borderRadius: RADIUS.surface,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'absolute',
    zIndex: 3,
  },
  /**
   * The resize grip, bottom-right.
   *
   * `touchAction: none` for the same reason the map canvas has it: without it the browser claims the drag
   * for scrolling before a single `pointermove` arrives, and the grip does nothing on a phone while working
   * perfectly on the desk the developer tested it on.
   */
  windowGrip: {
    background: 'transparent',
    border: 'none',
    bottom: 0,
    cursor: 'nwse-resize',
    height: 18,
    padding: 0,
    position: 'absolute',
    right: 0,
    touchAction: 'none',
    width: 18,
  },
  /** The same grip where a finger is the pointer: 44 in both axes, per `TOUCH_TARGET`. */
  windowGripTouch: {
    background: 'transparent',
    border: 'none',
    bottom: 0,
    cursor: 'nwse-resize',
    height: TOUCH_TARGET,
    padding: 0,
    position: 'absolute',
    right: 0,
    touchAction: 'none',
    width: TOUCH_TARGET,
  },
  /**
   * The title bar, which is also the drag handle — and a real `<button>`, so it is in the tab order and
   * carries the console's focus ring without a line of extra work. Arrow keys move the window from here,
   * which is the only way a window is movable at all without a pointer.
   */
  windowHeader: {
    alignItems: 'center',
    background: RAMP.surfaceRaised,
    border: 'none',
    borderBottom: `1px solid ${RAMP.line}`,
    color: RAMP.textMuted,
    cursor: 'move',
    display: 'flex',
    fontSize: TEXT.micro,
    fontVariantNumeric: NUM,
    fontWeight: 700,
    gap: SPACE.sm,
    letterSpacing: 0.6,
    // `overflow: hidden` and NOT `minWidth: 0`. The shrinking belongs to the tally inside, which is the
    // flex item that refuses to shrink below its content; a `minWidth: 0` here would say this 44-px target
    // may be zero wide, and `styles.test.ts` is right to fail that — it cannot see that the window around
    // it is never narrower than `MIN_WINDOW.w`.
    overflow: 'hidden',
    padding: '7px 10px',
    textAlign: 'left',
    textTransform: 'uppercase',
    touchAction: 'none',
    width: '100%',
  },
  windowHeaderTouch: {
    alignItems: 'center',
    background: RAMP.surfaceRaised,
    border: 'none',
    borderBottom: `1px solid ${RAMP.line}`,
    color: RAMP.textMuted,
    cursor: 'move',
    display: 'flex',
    fontSize: TEXT.caption,
    fontVariantNumeric: NUM,
    fontWeight: 700,
    gap: SPACE.sm,
    letterSpacing: 0.6,
    minHeight: TOUCH_TARGET,
    overflow: 'hidden',
    padding: '7px 10px',
    textAlign: 'left',
    textTransform: 'uppercase',
    touchAction: 'none',
    width: '100%',
  },
  /** A window that has not been placed yet: it must be in the DOM to have an `offsetParent` to measure. */
  windowPending: { height: 0, left: 0, position: 'absolute', top: 0, width: 0 },
} satisfies Record<string, CSSProperties>;
