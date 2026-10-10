import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface FaceSample {
  landmarks: NormalizedLandmark[];
  confidence: number;
  time: number;
}

export class FaceLandmarkerAdapter {
  private landmarker: FaceLandmarker | null = null;

  async load(onProgress?: (phase: 'loading-model' | 'ready') => void): Promise<void> {
    if (this.landmarker) return;
    onProgress?.('loading-model');
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    const options = {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false
    } as const;
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
    }
    onProgress?.('ready');
  }

  detect(video: HTMLVideoElement, time: number): FaceSample | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const result = this.landmarker.detectForVideo(video, time);
    const landmarks = result.faceLandmarks[0];
    if (!landmarks) return null;
    return { landmarks, confidence: 0.85, time };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
