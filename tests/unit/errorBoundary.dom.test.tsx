// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary.tsx';

function Explode(): never {
  throw new Error('the encoder fell over');
}

describe('<ErrorBoundary />', () => {
  beforeEach(() => {
    // React logs the caught error itself; silence it so the run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all fine')).toBeDefined();
  });

  it('shows a recovery message instead of a blank page when a child throws', () => {
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('crash')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('went wrong');
  });

  it('surfaces the underlying message, since there is no server log to consult', () => {
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText('the encoder fell over')).toBeDefined();
  });

  it('reassures the user that nothing left their machine', () => {
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/nothing was uploaded/i);
  });

  it('offers a way out', () => {
    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });
});
