/**
 * Lab debug panel (074/16 round 2 — the vehicle look bench): the prod F2 time shortcuts as DOM buttons +
 * a 24 h slider, and the env-probe toggles. Mutates the shared state object and pings `onChange` — the main
 * loop reads the state every frame, so everything is live without a reload.
 */
export interface DebugPanelState {
  hour: number;
  probe: boolean;
  probeView: boolean;
}

const HOURS: readonly number[] = [0, 6, 12, 18, 21];

export function mountDebugPanel(state: DebugPanelState, onChange: () => void): void {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:10;background:rgba(10,12,18,0.85);color:#cfd6e4;' +
    'font:12px/1.6 ui-monospace,monospace;padding:10px 12px;border-radius:6px;display:flex;' +
    'flex-direction:column;gap:6px;min-width:180px';

  const time = document.createElement('div');
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '23.9';
  slider.step = '0.1';
  slider.value = String(state.hour);
  slider.style.width = '100%';

  const setHour = (hour: number): void => {
    state.hour = hour;
    slider.value = String(hour);
    time.textContent = `time ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
    onChange();
  };
  for (const hour of HOURS) {
    const button = document.createElement('button');
    button.textContent = `${String(hour).padStart(2, '0')}:00`;
    button.style.cssText = 'font:11px ui-monospace,monospace;padding:3px 6px;cursor:pointer';
    button.addEventListener('click', () => setHour(hour));
    buttons.appendChild(button);
  }
  slider.addEventListener('input', () => setHour(Number(slider.value)));

  const toggle = (label: string, initial: boolean, apply: (on: boolean) => void): HTMLLabelElement => {
    const wrapper = document.createElement('label');
    wrapper.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.addEventListener('change', () => {
      apply(input.checked);
      onChange();
    });
    wrapper.append(input, document.createTextNode(label));

    return wrapper;
  };

  panel.append(
    time,
    buttons,
    slider,
    toggle('env probe (074/16)', state.probe, (on) => (state.probe = on)),
    toggle('probe view (debug)', state.probeView, (on) => (state.probeView = on)),
  );
  document.body.appendChild(panel);
  setHour(state.hour);
}
