import { APP_NAME, APP_TAGLINE } from './core/appInfo.ts';

export function App() {
  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">{APP_NAME}</h1>
        <p className="app__tagline">{APP_TAGLINE}</p>
      </header>
      <section className="app__stage" data-testid="stage">
        <p className="app__placeholder">
          Editor coming in the next stage. Everything runs in your browser — no upload, no server.
        </p>
      </section>
    </main>
  );
}
