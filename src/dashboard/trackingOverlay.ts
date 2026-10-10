import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export interface TrackingOverlayFrame {
  face: NormalizedLandmark[] | null;
  hand: NormalizedLandmark[] | null;
  headEnabled: boolean;
  handEnabled: boolean;
}

const handConnections: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

const faceGuide = [
  [.5, .14], [.34, .2], [.66, .2], [.25, .43], [.75, .43], [.35, .7], [.65, .7]
] as const;

const handGuide = [
  [.5, .78], [.36, .6], [.43, .35], [.5, .25], [.58, .34], [.68, .45]
] as const;

function point(canvas: HTMLCanvasElement, landmark: NormalizedLandmark): [number, number] {
  // The preview is mirrored for the user, so mirror the overlay coordinates too.
  return [(1 - landmark.x) * canvas.width, landmark.y * canvas.height];
}

function guidePoint(canvas: HTMLCanvasElement, [x, y]: readonly [number, number]): [number, number] {
  return [(1 - x) * canvas.width, y * canvas.height];
}

function drawDots(context: CanvasRenderingContext2D, points: [number, number][], color: string, radius: number): void {
  context.fillStyle = color;
  for (const [x, y] of points) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawGuide(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: readonly (readonly [number, number])[], color: string): void {
  const mapped = points.map((item) => guidePoint(canvas, item));
  context.save();
  context.setLineDash([5, 7]);
  context.strokeStyle = `${color}99`;
  context.lineWidth = Math.max(1.5, canvas.width / 500);
  context.beginPath();
  for (const [index, [x, y]] of mapped.entries()) {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
  drawDots(context, mapped, color, Math.max(2.5, canvas.width / 120));
}

export function clearTrackingOverlay(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
  canvas.getContext('2d')?.clearRect(0, 0, 1, 1);
}

export function drawTrackingOverlay(canvas: HTMLCanvasElement | null, frame: TrackingOverlayFrame): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (frame.headEnabled) {
    if (frame.face?.length) {
      drawDots(context, frame.face.map((landmark) => point(canvas, landmark)), 'rgba(125, 211, 252, .88)', Math.max(1.2, canvas.width / 700));
    } else {
      drawGuide(context, canvas, faceGuide, '#7dd3fc');
    }
  }

  if (frame.handEnabled) {
    if (frame.hand?.length) {
      context.save();
      context.strokeStyle = 'rgba(74, 222, 128, .9)';
      context.lineWidth = Math.max(2, canvas.width / 420);
      for (const [from, to] of handConnections) {
        if (!frame.hand[from] || !frame.hand[to]) continue;
        const start = point(canvas, frame.hand[from]);
        const end = point(canvas, frame.hand[to]);
        context.beginPath();
        context.moveTo(start[0], start[1]);
        context.lineTo(end[0], end[1]);
        context.stroke();
      }
      context.restore();
      drawDots(context, frame.hand.map((landmark) => point(canvas, landmark)), '#4ade80', Math.max(2.4, canvas.width / 260));
    } else {
      drawGuide(context, canvas, handGuide, '#4ade80');
    }
  }
}
