import { describe, expect, it } from 'vitest';
import type { CalibrationGeometry } from '../shared/types';
import { buildCalibration, mapCameraToViewport, mapCameraToViewportDebug, normalizedCameraPoint, visibleCameraPoint } from './coordinateMapping';

const geometry: CalibrationGeometry = { cameraWidth: 1280, cameraHeight: 720, videoWidth: 640, videoHeight: 360, displayWidth: 640, displayHeight: 360, viewportWidth: 1280, viewportHeight: 720, devicePixelRatio: 1, scrollX: 0, scrollY: 0 };

describe('shared coordinate mapping', () => {
  it('rejects folded corner geometry instead of creating a jumping pointer', () => {
    const points = {
      'top-left': { camera: { x: .1, y: .1 }, viewport: { x: .08, y: .1 } },
      'top-right': { camera: { x: .9, y: .9 }, viewport: { x: .92, y: .1 } },
      'bottom-left': { camera: { x: .1, y: .9 }, viewport: { x: .08, y: .9 } },
      'bottom-right': { camera: { x: .9, y: .1 }, viewport: { x: .92, y: .9 } }
    } as const;
    expect(buildCalibration(points, { mirrored: false, input: 'hand', geometry })).toBeNull();
  });
  it('applies mirror correction exactly once', () => {
    expect(normalizedCameraPoint({ x: .2, y: .4 }, true)).toEqual({ x: .8, y: .4 });
    expect(normalizedCameraPoint({ x: .2, y: .4 }, false)).toEqual({ x: .2, y: .4 });
  });

  it('corrects a wide camera displayed in a square cover box', () => {
    const square = { ...geometry, displayWidth: 500, displayHeight: 500 };
    expect(visibleCameraPoint({ x: .5, y: .5 }, square)).toEqual({ x: .5, y: .5 });
    expect(visibleCameraPoint({ x: 0, y: .5 }, square).x).toBe(0.01);
  });

  it('maps calibrated corners and center into the shared viewport', () => {
    const points = {
      'top-left': { camera: { x: .8, y: .1 }, viewport: { x: .08, y: .1 } },
      'top-right': { camera: { x: .2, y: .1 }, viewport: { x: .92, y: .1 } },
      'bottom-left': { camera: { x: .8, y: .9 }, viewport: { x: .08, y: .9 } },
      'bottom-right': { camera: { x: .2, y: .9 }, viewport: { x: .92, y: .9 } }
    } as const;
    const calibration = buildCalibration(points, { mirrored: true, input: 'mixed', geometry });
    expect(calibration).not.toBeNull();
    expect(mapCameraToViewport({ x: .5, y: .5 }, calibration, geometry)).toEqual({ x: .5, y: .5 });
    expect(mapCameraToViewport({ x: .8, y: .1 }, calibration, geometry)!.x).toBeCloseTo(.08, 2);
  });

  it('stores calibration corners after the same cover-crop correction used at runtime', () => {
    const square = { ...geometry, displayWidth: 500, displayHeight: 500 };
    const rawLeft = 0.21875;
    const rawRight = 0.78125;
    const points = {
      'top-left': { camera: { x: rawLeft, y: .1 }, viewport: { x: .08, y: .1 } },
      'top-right': { camera: { x: rawRight, y: .1 }, viewport: { x: .92, y: .1 } },
      'bottom-left': { camera: { x: rawLeft, y: .9 }, viewport: { x: .08, y: .9 } },
      'bottom-right': { camera: { x: rawRight, y: .9 }, viewport: { x: .92, y: .9 } }
    } as const;
    const calibration = buildCalibration(points, { mirrored: false, input: 'hand', geometry: square });
    expect(calibration).not.toBeNull();
    expect(mapCameraToViewport({ x: rawLeft, y: .1 }, calibration, square, false)!.x).toBeCloseTo(.08, 2);
    expect(mapCameraToViewport({ x: rawRight, y: .1 }, calibration, square, false)!.x).toBeCloseTo(.92, 2);
  });

  it('rejects incomplete and low-spread calibration data', () => {
    expect(buildCalibration({ 'top-left': { camera: { x: .5, y: .5 }, viewport: { x: .08, y: .1 } } }, { mirrored: true, input: 'hand', geometry })).toBeNull();
    const tiny = { 'top-left': { camera: { x: .49, y: .49 }, viewport: { x: .08, y: .1 } }, 'top-right': { camera: { x: .51, y: .49 }, viewport: { x: .92, y: .1 } }, 'bottom-left': { camera: { x: .49, y: .51 }, viewport: { x: .08, y: .9 } }, 'bottom-right': { camera: { x: .51, y: .51 }, viewport: { x: .92, y: .9 } } } as const;
    expect(buildCalibration(tiny, { mirrored: false, input: 'hand', geometry })).toBeNull();
  });

  it('does not invent a center point when a live landmark or inverse mapping is unavailable', () => {
    expect(mapCameraToViewportDebug(null, null, geometry)).toMatchObject({ point: null, fallbackUsed: false, fallbackReason: 'missing-landmark' });
    const degenerate = {
      version: 2,
      mirrored: false,
      input: 'hand',
      geometry,
      quality: 1,
      points: {
        'top-left': { camera: { x: .5, y: .5 }, viewport: { x: .08, y: .1 } },
        'top-right': { camera: { x: .5, y: .5 }, viewport: { x: .92, y: .1 } },
        'bottom-left': { camera: { x: .5, y: .5 }, viewport: { x: .08, y: .9 } },
        'bottom-right': { camera: { x: .5, y: .5 }, viewport: { x: .92, y: .9 } }
      },
      createdAt: Date.now()
    } as never;
    expect(mapCameraToViewportDebug({ x: .7, y: .3 }, degenerate, geometry, false)).toMatchObject({ point: null, fallbackUsed: true, fallbackReason: 'inverse-failed' });
  });
});
