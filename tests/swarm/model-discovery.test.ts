import { describe, expect, it } from 'vitest';
import { isModelAvailable, stripThinkingLevel } from '../../model-discovery.js';

describe('model-discovery thinking suffix', () => {
  it('strips a thinking-level suffix for inventory lookup', () => {
    expect(stripThinkingLevel('openai-codex/gpt-5.6-sol:medium')).toBe('openai-codex/gpt-5.6-sol');
    expect(stripThinkingLevel('openai-codex/gpt-5.6-sol:high')).toBe('openai-codex/gpt-5.6-sol');
    expect(stripThinkingLevel('openai-codex/gpt-5.6-sol')).toBe('openai-codex/gpt-5.6-sol');
    expect(stripThinkingLevel('umans/umans-glm-5.2:low')).toBe('umans/umans-glm-5.2');
  });

  it('isModelAvailable uses the inventory without the suffix', () => {
    expect(isModelAvailable('openai-codex/gpt-5.6-sol:medium')).toBe(
      isModelAvailable('openai-codex/gpt-5.6-sol')
    );
  });
});
