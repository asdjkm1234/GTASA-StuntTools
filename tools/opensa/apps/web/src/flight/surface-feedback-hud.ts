import type { SurfaceAxis, SurfaceFeedback } from './surface-feedback';

import { pedalPresses } from './surface-feedback';

export const FEEDBACK_WIDTH = 240;
export const FEEDBACK_HEIGHT = 204;

/** Shared drawing for the visible overlay and the exported video. All directions are aircraft-local. */
export function drawSurfaceFeedback(ctx: CanvasRenderingContext2D, state: SurfaceFeedback): void {
  ctx.clearRect(0, 0, FEEDBACK_WIDTH, FEEDBACK_HEIGHT);
  ctx.fillStyle = '#0d1928df';
  ctx.beginPath();
  ctx.roundRect(0, 0, FEEDBACK_WIDTH, FEEDBACK_HEIGHT, 12);
  ctx.fill();
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8f0fa';
  ctx.fillText('舵面反馈 · 机体方向', 120, 22);
  const accent = '#4fd1c5';
  const muted = '#91a4ba';
  ctx.strokeStyle = '#496079';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(73, 91, 38, 0, Math.PI * 2);
  ctx.moveTo(35, 91);
  ctx.lineTo(111, 91);
  ctx.moveTo(73, 53);
  ctx.lineTo(73, 129);
  ctx.stroke();
  ctx.fillStyle = muted;
  ctx.fillText('推', 73, 47);
  ctx.fillText('拉', 73, 147);
  ctx.fillText('左', 23, 95);
  ctx.fillText('右', 123, 95);
  const pitch = state.pitch.value;
  const roll = state.roll.value;
  if (pitch !== null && roll !== null) {
    const scale = Math.max(1, Math.hypot(pitch, roll));
    const x = 73 + (roll / scale) * 33;
    const y = 91 + (pitch / scale) * 33;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(73, 91);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = muted;
    ctx.fillText('?', 73, 95);
    // An available axis stays visible without fabricating the missing axis's center position.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (roll !== null) {
      ctx.moveTo(73 + roll * 33, 83);
      ctx.lineTo(73 + roll * 33, 99);
    }
    if (pitch !== null) {
      ctx.moveTo(65, 91 + pitch * 33);
      ctx.lineTo(81, 91 + pitch * 33);
    }
    ctx.stroke();
  }
  drawPedals(ctx, state.yaw.value);
  const statuses = [axisLabel('俯仰', state.pitch), axisLabel('横滚', state.roll), axisLabel('偏航', state.yaw)].filter(
    Boolean,
  );
  ctx.font = '10px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = statuses.length || state.damaged ? '#f5c66e' : muted;
  ctx.fillText(statuses.join(' · ') || '操纵杆 / 偏航踏板', 120, 170);
  ctx.fillStyle = state.damaged ? '#f5c66e' : muted;
  ctx.fillText(feedbackFooter(state), 120, 190);
}

export function showSurfaceFeedback(cameraMode: string): boolean {
  return ['chase-far', 'chase-mid', 'chase-near'].includes(cameraMode);
}

function axisLabel(name: string, axis: SurfaceAxis): string {
  return axis.source === 'unknown' ? name + '未知' : axis.source === 'partial' ? name + '单侧' : '';
}

function drawPedal(ctx: CanvasRenderingContext2D, side: number, x: number, press: null | number): void {
  drawPedalBody(ctx, x, press);
  const active = press !== null && press > 0;
  ctx.fillStyle = active ? '#4fd1c5' : '#91a4ba';
  ctx.font = '9px "Microsoft YaHei", sans-serif';
  ctx.fillText(press === null ? '未知' : active ? (side < 0 ? '左偏航' : '右偏航') : '中立', x, 133);
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#91a4ba';
  ctx.fillText(side < 0 ? '左踏板' : '右踏板', x, 147);
}

function drawPedalBody(ctx: CanvasRenderingContext2D, x: number, press: null | number): void {
  const accent = '#4fd1c5',
    muted = '#91a4ba';
  const depression = press ?? 0;
  // Push a rigid solid away from the viewer. Face tilt stays constant: no animated flattening.
  const angle = depression * 0.3;
  const depth = 24 - 24 * Math.cos(angle) + 30 * Math.sin(angle);
  const down = 30 * Math.cos(angle) + 24 * Math.sin(angle);
  const active = press !== null && press > 0;
  type Point = [number, number, number];
  function project([px, py, pz]: Point): [number, number] {
    const scale = 70 / (70 + pz);

    return [x + px * scale, 96 + (py - 47 - pz * 0.22) * scale];
  }
  function polygon(points: Point[]): void {
    ctx.beginPath();
    for (const [index, point] of points.entries()) {
      const [px, py] = project(point);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  // The upper mount stays fixed; the complete arm follows the face into the footwell.
  ctx.strokeStyle = active ? accent : '#496079';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(...project([0, 0, 0]));
  ctx.lineTo(...project([0, down, depth]));
  ctx.stroke();
  ctx.strokeStyle = '#496079';
  ctx.fillStyle = '#142332';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, 49, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Extruded trapezoid/semicircle, projected vertex by vertex with a mild, fixed face inclination.
  function facePoint(px: number, py: number, thickness = 0): Point {
    return [
      px,
      down + py * Math.cos(0.2) - thickness * Math.sin(0.2),
      depth + py * Math.sin(0.2) + thickness * Math.cos(0.2),
    ];
  }
  const outline: [number, number][] = [
    [-9, 0],
    [9, 0],
  ];
  for (let step = 0; step <= 20; step++) {
    const a = (step * Math.PI) / 20;
    outline.push([12 * Math.cos(a), 22 + 12 * Math.sin(a)]);
  }
  const front = outline.map(([px, py]) => facePoint(px, py));
  const rear = outline.map(([px, py]) => facePoint(px, py, 4));
  polygon(rear);
  ctx.fillStyle = active ? '#17423f' : '#0a1420';
  ctx.fill();
  for (let index = 0; index < front.length; index++) {
    const next = (index + 1) % front.length;
    polygon([front[index], rear[index], rear[next], front[next]]);
    ctx.fill();
  }
  polygon(front);
  ctx.fillStyle = active ? '#4fd1c554' : '#142332';
  ctx.fill();
  ctx.strokeStyle = active ? accent : muted;
  ctx.setLineDash(press === null ? [3, 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);
  if (press === null) {
    ctx.fillStyle = muted;
    ctx.fillText('?', ...project(facePoint(0, 22)));
  } else {
    for (const offset of [-5, 5]) {
      const recess: Point[] = [];
      for (let step = 0; step < 16; step++) {
        const a = (step * Math.PI * 2) / 16;
        recess.push(facePoint(offset + 2 * Math.cos(a), 16 + 2 * Math.sin(a)));
      }
      polygon(recess);
      ctx.fillStyle = active ? accent : muted;
      ctx.fill();
    }
  }
  ctx.lineWidth = 1;
}

function drawPedals(ctx: CanvasRenderingContext2D, value: null | number): void {
  const presses = pedalPresses(value);
  drawPedal(ctx, -1, 158, presses.left);
  drawPedal(ctx, 1, 201, presses.right);
}

function feedbackFooter(state: SurfaceFeedback): string {
  if (state.damaged) return '舵面损坏 · 显示可用节点';
  if ([state.pitch, state.roll, state.yaw].every((axis) => axis.value === null)) return '舵面状态不可用';

  return state.damageUnknown ? '损伤状态未采集' : '真实舵面';
}
