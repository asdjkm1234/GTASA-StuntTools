import { describe, expect, it } from 'vitest';

import { pipelineIdFor } from './pipelines';
import { assertGuardrails, resolveShader, shaderModuleNames } from './shaders';

describe('shader store', () => {
  describe('negative cases', () => {
    it('rejects an unknown module', () => {
      expect(() => resolveShader('nope')).toThrow(/unknown shader module/);
    });

    it('guardrail bans uniform-space arrays (the 073 naga/Metal occupancy trap)', () => {
      const banned = 'struct P { l: array<vec4f, 12> };\n@group(0) @binding(0) var<uniform> pool: array<vec4f, 12>;';

      expect(() => assertGuardrails('test', banned)).toThrow(/uniform-space array/);
    });

    it('guardrail bans unbounded loops', () => {
      expect(() => assertGuardrails('test', 'fn f() { loop { } }')).toThrow(/unbounded loop/);
    });
  });

  describe('positive cases', () => {
    it('resolves the world shader with its includes expanded and guardrails clean', () => {
      const wgsl = resolveShader('world');

      expect(wgsl).toContain('fn vsWorld');
      expect(wgsl).toContain('fn fsWorld');
      expect(wgsl).toContain('var<uniform> frame: Frame'); // the include landed
      expect(wgsl).not.toContain('#include');
    });

    it('golden snapshot per module (shader diffs become reviewable)', () => {
      for (const name of shaderModuleNames()) {
        expect(resolveShader(name)).toMatchSnapshot(name);
      }
    });

    it('maps .oscell group classes onto the enumerated pipeline ids', () => {
      expect(pipelineIdFor(0, 0)).toBe('world-opaque-front');
      expect(pipelineIdFor(0, 1)).toBe('world-opaque-double');
      expect(pipelineIdFor(1, 0)).toBe('world-cutout-front');
      expect(pipelineIdFor(2, 1)).toBe('world-blend-double');
      expect(pipelineIdFor(3, 0)).toBe('world-beam-front');
      expect(pipelineIdFor(4, 0)).toBe('world-additive-front');
      expect(pipelineIdFor(4, 1)).toBe('world-additive-double');
    });
  });
});
