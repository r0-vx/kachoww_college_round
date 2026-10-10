import { describe, expect, it, vi } from 'vitest';
import { CameraThumbnail } from './cameraThumbnail';

function preview() {
  const drawImage = vi.fn();
  const toDataURL = vi.fn(() => 'data:image/jpeg;base64,thumbnail');
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL } as unknown as HTMLCanvasElement;
  const createCanvas = vi.fn(() => canvas);
  const state = { readyState: 2, paused: false, videoWidth: 1280, videoHeight: 720, currentTime: 1 };
  const video = state as unknown as HTMLVideoElement;
  return { encoder: new CameraThumbnail(createCanvas), canvas, video, state, drawImage, toDataURL, createCanvas };
}

describe('dashboard camera thumbnail', () => {
  it('encodes fresh frames at no more than five fps and reuses one canvas', () => {
    const { encoder, canvas, video, drawImage, toDataURL, createCanvas } = preview();
    expect(encoder.frame(video, 0)).toContain('data:image/jpeg');
    video.currentTime = 2;
    expect(encoder.frame(video, 199)).toBeUndefined();
    expect(encoder.frame(video, 200)).toContain('data:image/jpeg');
    expect(encoder.frame(video, 400)).toBeUndefined();
    expect(toDataURL).toHaveBeenCalledTimes(2);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', .6);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 320, 180);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(createCanvas).toHaveBeenCalledTimes(1);
    encoder.reset();
    expect(encoder.frame(video, 401)).toContain('data:image/jpeg');
  });

  it('skips paused or unavailable video without encoding', () => {
    const { encoder, video, state, toDataURL } = preview();
    expect(encoder.frame(null, 0)).toBeUndefined();
    state.paused = true;
    expect(encoder.frame(video, 0)).toBeUndefined();
    state.paused = false;
    state.readyState = 1;
    expect(encoder.frame(video, 200)).toBeUndefined();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('contains encoding errors and throttles subsequent attempts', () => {
    const { encoder, video, toDataURL } = preview();
    toDataURL.mockImplementation(() => { throw new Error('Encoding unavailable'); });
    expect(encoder.frame(video, 0)).toBeUndefined();
    video.currentTime = 2;
    expect(encoder.frame(video, 100)).toBeUndefined();
    expect(toDataURL).toHaveBeenCalledTimes(1);
  });
});
