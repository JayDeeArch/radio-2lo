import { NavLink, Route, Routes } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { HomePage } from './pages/HomePage.tsx';
import { StatusPage } from './pages/StatusPage.tsx';
import { PlaylistPage } from './pages/PlaylistPage.tsx';
import { DedicationsPage } from './pages/DedicationsPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { EqualizerBars } from './components/EqualizerBars.tsx';

const NAV = [
  { to: '/', label: 'Zaproponuj' },
  { to: '/status', label: 'Status' },
  { to: '/playlist', label: 'Playlista' },
  { to: '/dedications', label: 'Dedykacje' },
  { to: '/admin', label: 'Admin' },
];

/** Mały znacznik „gra” - jedyny animowany element w całym interfejsie. */
function Playing() {
  return (
    <span className="text-accent">
      <EqualizerBars className="h-3" />
    </span>
  );
}

export function App() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <a
        href="#tresc"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-ink focus:bg-ink focus:px-3 focus:py-1.5 focus:font-semibold focus:text-paper"
      >
        Przejdź do treści
      </a>

      <header className="sticky top-0 z-40 border-b border-rule bg-paper/92 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3.5">
          <NavLink to="/" className="flex shrink-0 items-baseline gap-2">
            <span className="text-[0.95rem] font-extrabold tracking-[-0.02em] uppercase">
              Szkolne
            </span>
            <span className="text-[0.95rem] font-extrabold tracking-[-0.02em] text-accent uppercase">
              Radio
            </span>
            <span className="ml-0.5 hidden sm:inline">
              <Playing />
            </span>
          </NavLink>

          <nav className="ml-auto flex flex-wrap items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `meta px-2.5 py-1.5 transition-colors ${
                    isActive ? 'bg-ink text-paper' : 'hover:text-ink'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main id="tresc" className="relative z-10 flex-1">
        <AnimatePresence mode="wait">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/playlist" element={<PlaylistPage />} />
            <Route path="/dedications" element={<DedicationsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </AnimatePresence>
      </main>

      <footer className="relative z-10 mt-20 border-t border-rule">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-5 py-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p className="meta">Szkolne Radio · platforma prośb o utwory</p>
          <a
            href="https://www.spotify.com/pl/polityka-prywatnosci/"
            target="_blank"
            rel="noreferrer noopener"
            className="meta underline decoration-rule underline-offset-4 hover:text-ink"
          >
            Prywatność Spotify
          </a>
        </div>
      </footer>
    </div>
  );
}
