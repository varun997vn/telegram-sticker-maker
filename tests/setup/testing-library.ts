import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest runs without globals, so React Testing Library's automatic cleanup
// never registers itself. Unmount between specs so queries stay unambiguous.
afterEach(() => {
  cleanup();
});
