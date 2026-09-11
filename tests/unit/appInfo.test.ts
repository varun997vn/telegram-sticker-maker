import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_TAGLINE } from '@/core/appInfo.ts';

describe('app info', () => {
  it('exposes a non-empty product name', () => {
    expect(APP_NAME.trim().length).toBeGreaterThan(0);
  });

  it('mentions both target platforms in the tagline', () => {
    expect(APP_TAGLINE).toMatch(/WhatsApp/i);
    expect(APP_TAGLINE).toMatch(/Telegram/i);
  });
});
