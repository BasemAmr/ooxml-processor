import { describe, expect, it } from 'vitest';
import { countWords, ToolsManager } from './word-count-dialog.js';
import { MockSpellcheckProvider } from '../../providers/spellcheck.js';
import { MockTranslationProvider } from '../../providers/translation.js';

describe('Wave 10 tools', () => {
  it('counts locale-aware words and characters', () => {
    expect(countWords('Hello world!').words).toBe(2);
    expect(countWords('Hello world!').charactersNoSpaces).toBe(11);
  });
  it('coordinates line-number toggle and mock providers', async () => {
    let enabled = false;
    const tools = new ToolsManager({ getText: () => 'one two', setLineNumbers: (value) => { enabled = value; } });
    expect(tools.toggleLineNumbers()).toBe(true);
    expect(enabled).toBe(true);
    expect((await new MockTranslationProvider().translate('hi', 'en', 'ar'))).toContain('ar');
    expect((await new MockSpellcheckProvider().check('hello nope'))).toHaveLength(1);
  });
});
