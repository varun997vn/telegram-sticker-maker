// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '@/App.tsx';
import { APP_NAME } from '@/core/appInfo.ts';

describe('<App />', () => {
  it('renders the product name as the page heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(APP_NAME);
  });

  it('renders the editor stage container', () => {
    render(<App />);
    expect(screen.getByTestId('stage')).toBeDefined();
  });
});
