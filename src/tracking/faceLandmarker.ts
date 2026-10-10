import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { trackingAssetPath, visionWasmPath } from './modelAssets';
import { landmarkQuality } from './landmarkQuality';

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
    const vision = await FilesetResolver.forVisionTasks(visionWasmPath);
    const options = {
      baseOptions: { modelAssetPath: trackingAssetPath('mediapipe/models/face_landmarker.task'), delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false
    } as const;
    let delegate = 'GPU';
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch (gpuError) {
      try {
        delegate = 'CPU';
        this.landmarker = await FaceLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
      } catch (cpuError) {
        const gpuMessage = gpuError instanceof Error ? gpuError.message : String(gpuError);
        const cpuMessage = cpuError instanceof Error ? cpuError.message : String(cpuError);
        console.error('[HandFree] Face model failed on GPU and CPU.', { gpuError, cpuError });
        throw new Error(`Face model failed to initialize. GPU: ${gpuMessage}. CPU fallback: ${cpuMessage}`);
      }
    }
    console.info(`[HandFree] Face Landmarker ready with bundled assets (${delegate}).`);
    onProgress?.('ready');
  }

  detect(video: HTMLVideoElement, time: number): FaceSample | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const result = this.landmarker.detectForVideo(video, time);
    const landmarks = result.faceLandmarks[0];
    if (!landmarks) return null;
    return { landmarks, confidence: landmarkQuality(landmarks, 468), time };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
