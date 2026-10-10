import { describe, expect, it } from 'vitest';
import { TouchViewGestureMachine } from './touchViewGesture';

describe('TouchView gesture state machine', () => {
  it('does not rearm a held pinch by moving to another target or losing tracking', () => {
    const machine = new TouchViewGestureMachine(100, 200, false);
    machine.update({ targetKey: 'a', gesture: 'pinch', confidence: .9, now: 0 });
    expect(machine.update({ targetKey: 'a', gesture: 'pinch', confidence: .9, now: 100 }).activate).toBe(true);
    machine.update({ targetKey: 'b', gesture: 'pinch', confidence: .9, now: 400 });
    expect(machine.update({ targetKey: 'b', gesture: 'pinch', confidence: .9, now: 600 }).activate).toBe(false);
    machine.update({ targetKey: null, gesture: 'pinch', confidence: 0, now: 650 });
    machine.update({ targetKey: 'b', gesture: 'pinch', confidence: .9, now: 700 });
    expect(machine.update({ targetKey: 'b', gesture: 'pinch', confidence: .9, now: 900 }).activate).toBe(false);
  });

  it('does not repeat stable hold activation on the same target', () => {
    const machine = new TouchViewGestureMachine(100, 200, true);
    machine.update({ targetKey: 'a', gesture: 'release', confidence: .9, now: 0 });
    expect(machine.update({ targetKey: 'a', gesture: 'release', confidence: .9, now: 100 }).activate).toBe(true);
    expect(machine.update({ targetKey: 'a', gesture: 'release', confidence: .9, now: 1000 }).activate).toBe(false);
  });
  it('activates one time per stable pinch and requires release', () => {
    const machine = new TouchViewGestureMachine(100, 200, false);
    expect(machine.update({ targetKey: 'button-a', gesture: 'pinch', confidence: .9, now: 0 }).activate).toBe(false);
    expect(machine.update({ targetKey: 'button-a', gesture: 'pinch', confidence: .9, now: 100 }).activate).toBe(true);
    expect(machine.update({ targetKey: 'button-a', gesture: 'pinch', confidence: .9, now: 300 }).activate).toBe(false);
    machine.release(301);
    expect(machine.state).toBe('COOLDOWN');
    expect(machine.update({ targetKey: 'button-a', gesture: 'release', confidence: .9, now: 501 }).activate).toBe(false);
    expect(machine.update({ targetKey: 'button-a', gesture: 'pinch', confidence: .9, now: 502 }).activate).toBe(false);
  });

  it('cancels a stable hold when the target changes or confidence drops', () => {
    const machine = new TouchViewGestureMachine(100, 200, true);
    machine.update({ targetKey: 'button-a', gesture: 'release', confidence: .9, now: 0 });
    expect(machine.update({ targetKey: 'button-a', gesture: 'release', confidence: .9, now: 50 }).activate).toBe(false);
    expect(machine.update({ targetKey: 'button-b', gesture: 'release', confidence: .9, now: 60 }).events.some((event) => event.type === 'hold-cancelled')).toBe(true);
    expect(machine.update({ targetKey: 'button-b', gesture: 'release', confidence: .2, now: 70 }).events.some((event) => event.type === 'hand-lost')).toBe(true);
  });
});
