import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center px-5 text-center">
      <p className="meta">Błąd 404</p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-[-0.03em]">Nie ma takiej strony</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Adres mógł się zmienić albo został wpisany błędnie.
      </p>
      <Link to="/" className="btn-primary mt-8">
        Wróć na stronę główną
      </Link>
    </div>
  );
}
