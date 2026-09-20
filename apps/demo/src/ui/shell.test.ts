// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AppShell } from './shell.js';

describe('AppShell', () => {
  it('switches the UI between LTR English and RTL Arabic', () => {
    const root = document.createElement('div');
    const shell = new AppShell({ root });
    expect(root.dir).toBe('ltr');
    shell.setLanguage('ar');
    expect(root.dir).toBe('rtl');
    expect(root.lang).toBe('ar');
    expect(root.textContent).toContain('ملف');
    shell.setLanguage('en');
    expect(root.dir).toBe('ltr');
    shell.destroy();
  });
});
