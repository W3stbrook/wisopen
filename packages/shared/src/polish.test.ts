import { describe, it, expect } from 'vitest';
import { needsLlmPolish, quickPolish } from './polish.js';

describe('needsLlmPolish', () => {
  it('skips clean short phrases', () => {
    expect(needsLlmPolish('hello world')).toBe(false);
    expect(needsLlmPolish('Send the report by Friday')).toBe(false);
  });
  it('requires polish for filler words', () => {
    expect(needsLlmPolish('um send the report')).toBe(true);
    expect(needsLlmPolish('you know the thing')).toBe(true);
  });
  it('requires polish for self-corrections', () => {
    expect(needsLlmPolish('no wait actually Tuesday')).toBe(true);
  });
});

describe('quickPolish', () => {
  it('capitalizes and trims', () => {
    expect(quickPolish('  hello   world  ')).toBe('Hello world');
  });
});
