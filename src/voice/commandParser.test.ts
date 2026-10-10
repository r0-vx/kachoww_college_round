import { describe, expect, it } from 'vitest';
import { parseVoiceCommand } from './commandParser';

describe('parseVoiceCommand', () => {
  it('parses deterministic navigation and interaction commands', () => {
    expect(parseVoiceCommand('scroll down')).toEqual({ type: 'scroll', direction: 'down' });
    expect(parseVoiceCommand('click the Activate Test Button')).toEqual({ type: 'click', query: 'activate test button' });
    expect(parseVoiceCommand('focus the name field')).toEqual({ type: 'focus', query: 'name' });
  });
  it('rejects unsupported speech without executing anything', () => { expect(parseVoiceCommand('do something clever')).toBeNull(); });
});
