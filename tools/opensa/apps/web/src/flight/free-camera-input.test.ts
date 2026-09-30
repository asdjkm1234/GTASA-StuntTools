// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { FreeCamera, FreeCameraInput } from './free-camera';

const inputs: FreeCameraInput[] = [];

function setup(): { camera: FreeCamera; element: HTMLElement; input: FreeCameraInput } {
  const camera = new FreeCamera({ pitch: 1.2, position: [10, 40, 20], yaw: 0 });
  const input = new FreeCameraInput(camera);
  const element = document.createElement('div');
  input.attach(element);
  inputs.push(input);
  return { camera, element, input };
}

function key(code: string, type: 'keydown' | 'keyup', repeat = false): void {
  window.dispatchEvent(new KeyboardEvent(type, { bubbles: true, code, repeat }));
}

afterEach(() => {
  for (const input of inputs) input.dispose();
  inputs.length = 0;
});

describe('FreeCameraInput movement', () => {
  it('keeps WASD level at a steep pitch and uses Space and Shift for world height', () => {
    const { camera, input } = setup();

    key('KeyW', 'keydown');
    input.update(0.1);
    key('KeyW', 'keyup');
    expect(camera.position).toEqual([10, 40, 11]);

    key('KeyD', 'keydown');
    input.update(0.1);
    key('KeyD', 'keyup');
    expect(camera.position).toEqual([19, 40, 11]);

    key('Space', 'keydown');
    input.update(0.1);
    key('Space', 'keyup');
    expect(camera.position).toEqual([19, 49, 11]);

    key('ShiftLeft', 'keydown');
    input.update(0.1);
    key('ShiftLeft', 'keyup');
    expect(camera.position).toEqual([19, 40, 11]);

    key('KeyQ', 'keydown');
    key('KeyE', 'keydown');
    input.update(0.1);
    expect(camera.position).toEqual([19, 40, 11]);
  });

  it('cycles medium, fast, ultra slow, slow on Ctrl press without repeat cycles', () => {
    const { camera, element, input } = setup();
    expect(input.speedLabel).toBe('中速');

    key('ControlLeft', 'keydown');
    expect(input.speedLabel).toBe('快速');
    key('ControlLeft', 'keydown', true);
    expect(input.speedLabel).toBe('快速');
    key('KeyW', 'keydown');
    input.update(0.1);
    expect(camera.position[2]).toBeCloseTo(-16);
    key('KeyW', 'keyup');
    key('ControlLeft', 'keyup');

    key('ControlRight', 'keydown');
    expect(input.speedLabel).toBe('极慢');
    key('KeyW', 'keydown');
    input.update(0.1);
    expect(camera.position[2]).toBeCloseTo(-16.045);
    key('KeyW', 'keyup');
    key('ControlRight', 'keyup');

    const beforeWheel = [...camera.position];
    element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 }));
    expect(Math.hypot(...camera.position.map((value, axis) => value - beforeWheel[axis]))).toBeCloseTo(0.04);

    key('ControlLeft', 'keydown');
    expect(input.speedLabel).toBe('慢速');
    key('ControlLeft', 'keyup');
    key('ControlLeft', 'keydown');
    expect(input.speedLabel).toBe('中速');
  });
});
