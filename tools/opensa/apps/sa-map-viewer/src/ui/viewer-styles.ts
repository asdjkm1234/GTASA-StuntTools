import type { CSSProperties } from 'react';

/** The viewer's own chrome — everything else is the debugger's `styles` (plan 094). */
export const viewerStyles: Record<string, CSSProperties> = {
  canvas: {
    display: 'block',
    height: '100%',
    left: 0,
    position: 'fixed',
    top: 0,
    width: '100%',
  },
  /** The source caption: every screenshot out of this tool says which tree it read (the A/B rule). */
  caption: {
    backgroundColor: 'rgba(8, 8, 8, 0.8)',
    borderRadius: 3,
    bottom: 12,
    color: '#fff',
    fontFamily: '"Courier New", monospace',
    fontSize: 11,
    padding: '5px 8px',
    pointerEvents: 'none',
    position: 'fixed',
    right: 12,
    zIndex: 1000,
  },
  /** The "this dir is already converted" notice — the accent colour the debugger warns in. */
  warning: {
    color: '#fd8709',
    fontSize: 11,
    lineHeight: 1.4,
  },
};
