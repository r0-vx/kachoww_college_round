import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandGesture } from '../shared/types';
import { trackingAssetPath, visionWasmPath } from './modelAssets';

export interface HandSample { landmarks: NormalizedLandmark[]; confidence: number; }

export interface HandPointerCoordinates { x: number; y: number; }

export class HandLandmarkerAdapter {
  private landmarker: HandLandmarker | null = null;
  async load(): Promise<void> {
    if (this.landmarker) return;
    const vision = await FilesetResolver.forVisionTasks(visionWasmPath);
    const options = { baseOptions: { modelAssetPath: trackingAssetPath('mediapipe/models/hand_landmarker.task'), delegate: 'GPU' as const }, runningMode: 'VIDEO' as const, numHands: 1, minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55 };
    let delegate = 'GPU';
    try { this.landmarker = await HandLandmarker.createFromOptions(vision, options); }
    catch (gpuError) {
      try { delegate = 'CPU'; this.landmarker = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
      catch (cpuError) {
        const gpuMessage = gpuError instanceof Error ? gpuError.message : String(gpuError);
        const cpuMessage = cpuError instanceof Error ? cpuError.message : String(cpuError);
        console.error('[HandFree] Hand model failed on GPU and CPU.', { gpuError, cpuError });
        throw new Error(`Hand model failed to initialize. GPU: ${gpuMessage}. CPU fallback: ${cpuMessage}`);
      }
    }
    console.info(`[HandFree] Hand Landmarker ready with bundled assets (${delegate}).`);
  }
  detect(video: HTMLVideoElement, time: number): HandSample | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const result = this.landmarker.detectForVideo(video, time);
    const landmarks = result.landmarks[0];
    return landmarks ? { landmarks, confidence: 0.82 } : null;
  }
  close(): void { this.landmarker?.close(); this.landmarker = null; }
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function clamp(value: number, min = 0.02, max = 0.98): number { return Math.max(min, Math.min(max, value)); }

export function interpretHand(sample: HandSample, pinchThreshold: number, handSensitivity = 1, previous?: HandPointerCoordinates): { x: number; y: number; gesture: HandGesture; confidence: number } {
  const tip = sample.landmarks[8];
  const thumb = sample.landmarks[4];
  const pinchDistance = distance(tip, thumb);
  const wrist = sample.landmarks[0];
  const openFingers = [8, 12, 16, 20].filter((index) => distance(sample.landmarks[index], wrist) > distance(sample.landmarks[index - 2], wrist)).length;
  const gesture: HandGesture = pinchDistance < pinchThreshold ? 'pinch' : openFingers >= 4 ? 'open-palm' : 'release';
  const sensitivity = Math.max(0.65, Math.min(1.6, handSensitivity));
  const target = { x: clamp(.5 + ((1 - tip.x) - .5) * sensitivity), y: clamp(.5 + (tip.y - .5) * sensitivity) };
  if (!previous) return { ...target, gesture, confidence: sample.confidence };
  const blend = .38;
  return { x: previous.x + (target.x - previous.x) * blend, y: previous.y + (target.y - previous.y) * blend, gesture, confidence: sample.confidence };
}
