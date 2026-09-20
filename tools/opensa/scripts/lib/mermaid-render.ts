/**
 * Render Mermaid diagram sources to standalone SVG files using the local `mermaid` package inside a headless
 * Playwright Chromium page (no network). Used by `scripts/arch-graph.ts` to produce the committed images under
 * `docs/architecture/assets/`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

export interface MermaidDiagram {
  readonly code: string;
  /** Output file base name (without extension), e.g. `loader-flow`. */
  readonly name: string;
}

/** Clean, low-noise look shared by every generated diagram (diagrams add their own classDef accents). */
const MERMAID_CONFIG = {
  flowchart: { curve: 'basis', htmlLabels: false, nodeSpacing: 40, padding: 12, rankSpacing: 48 },
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
  securityLevel: 'loose',
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    edgeLabelBackground: '#ffffff',
    fontSize: '14px',
    lineColor: '#7b8794',
    primaryBorderColor: '#7b8794',
    primaryColor: '#f4f6f8',
    primaryTextColor: '#1f2733',
    tertiaryColor: '#fafbfc',
  },
} as const;

/** Render each diagram to `<name>.svg` inside `outDir`; returns the written file paths. */
export async function renderMermaidSvgs(diagrams: readonly MermaidDiagram[], outDir: string): Promise<string[]> {
  const mermaidJs = join(process.cwd(), 'node_modules/mermaid/dist/mermaid.min.js');
  const browser = await chromium.launch();
  const written: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: mermaidJs });
    await page.evaluate((config) => {
      (window as unknown as { mermaid: { initialize(c: unknown): void } }).mermaid.initialize(config);
    }, MERMAID_CONFIG);
    for (const diagram of diagrams) {
      const svg = await page.evaluate(async ({ code, name }) => {
        const mermaid = (window as unknown as { mermaid: { render(id: string, c: string): Promise<{ svg: string }> } })
          .mermaid;
        const result = await mermaid.render(`diagram_${name.replace(/[^a-z0-9]/gi, '_')}`, code);

        return result.svg;
      }, diagram);
      const file = join(outDir, `${diagram.name}.svg`);
      writeFileSync(file, `${svg.trim()}\n`, 'utf8');
      written.push(file);
    }
  } finally {
    await browser.close();
  }

  return written;
}
