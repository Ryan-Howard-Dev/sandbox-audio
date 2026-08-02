import React, { useCallback, useState } from 'react';
import { Check, Download, Loader2, Search } from 'lucide-react';
import {
  downloadCalibreBook,
  loadCalibreWebSettings,
  probeCalibreWeb,
  saveCalibreWebSettings,
  searchCalibreWeb,
  type CalibreBook,
  type CalibreWebFailure,
} from '../../calibreWeb';
import { formatLabel } from '../../opdsFeed';
import { useTranslation } from '../../i18n';

export interface CalibreWebPanelProps {
  /** Hands the downloaded book to the shelf's own importer, so nothing here knows about EPUBs. */
  onImportFile: (file: File) => Promise<void>;
  onClose: () => void;
  onError?: (message: string) => void;
}

/**
 * Books from a calibre-web server.
 *
 * The shelf can already import a Calibre library from a picked folder, which works when the
 * library is on the same machine as the app. Usually it is not: the library is on a box somewhere
 * and calibre-web is what makes it reachable. This is that half.
 *
 * Search and download only. Adding, editing and deleting books on the server are calibre-web's own
 * job, and doing them badly from here would be worse than not doing them.
 *
 * A downloaded book goes through the shelf's ordinary import, so it is read, covered, paginated
 * and narrated exactly like one picked off disk. There is no second path that could behave
 * differently.
 */
export default function CalibreWebPanel({ onImportFile, onClose, onError }: CalibreWebPanelProps) {
  const { t } = useTranslation();
  const initial = loadCalibreWebSettings();
  const [url, setUrl] = useState(initial.url);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState(initial.password);
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<CalibreBook[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<string | null>(null);
  /** Ids already pulled in this session, so a second tap does not fetch the same book twice. */
  const [imported, setImported] = useState<Set<string>>(new Set());

  const failureMessage = useCallback(
    (reason: CalibreWebFailure): string => {
      if (reason === 'not-configured') return t('audiobooks.calibreWebNoUrl');
      if (reason === 'unauthorised') return t('audiobooks.calibreWebUnauthorised');
      if (reason === 'not-a-catalog') return t('audiobooks.calibreWebNotCatalog');
      if (reason === 'no-readable-format') return t('audiobooks.calibreWebNoFormat');
      return t('audiobooks.calibreWebUnreachable');
    },
    [t],
  );

  const persist = useCallback(() => {
    saveCalibreWebSettings({ url, username, password });
  }, [url, username, password]);

  const onConnect = useCallback(async () => {
    persist();
    setBusy(true);
    setConnected(null);
    try {
      const result = await probeCalibreWeb({ url, username, password });
      if (!result.ok) {
        onError?.(failureMessage(result.reason ?? 'unreachable'));
        return;
      }
      setConnected(result.title || t('audiobooks.calibreWebConnected'));
      // Show the newest books straight away. An empty catalogue view with a search box is a
      // dead end for someone who does not yet know what is on their own server.
      const found = await searchCalibreWeb('', { url, username, password });
      setBooks(found.books);
    } finally {
      setBusy(false);
    }
  }, [failureMessage, onError, password, persist, t, url, username]);

  const onSearch = useCallback(async () => {
    persist();
    setBusy(true);
    try {
      const found = await searchCalibreWeb(query, { url, username, password });
      if (found.reason) {
        onError?.(failureMessage(found.reason));
        return;
      }
      setBooks(found.books);
    } finally {
      setBusy(false);
    }
  }, [failureMessage, onError, password, persist, query, url, username]);

  const onDownload = useCallback(
    async (book: CalibreBook) => {
      setBusy(true);
      try {
        const { file, reason } = await downloadCalibreBook(book, { url, username, password });
        if (!file) {
          onError?.(failureMessage(reason ?? 'unreachable'));
          return;
        }
        await onImportFile(file);
        setImported((current) => new Set(current).add(book.id));
      } finally {
        setBusy(false);
      }
    },
    [failureMessage, onError, onImportFile, password, url, username],
  );

  return (
    <div className="px-1 mb-3 space-y-2">
      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t('audiobooks.calibreWebUrlPlaceholder')}
        className="audiobook-doc-url-input"
        aria-label={t('audiobooks.calibreWebUrlLabel')}
      />
      <div className="flex gap-2">
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('audiobooks.calibreWebUser')}
          className="audiobook-doc-url-input flex-1"
          aria-label={t('audiobooks.calibreWebUser')}
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('audiobooks.calibreWebPassword')}
          className="audiobook-doc-url-input flex-1"
          aria-label={t('audiobooks.calibreWebPassword')}
        />
      </div>
      <p className="audiobook-doc-url-hint">{t('audiobooks.calibreWebHint')}</p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="audiobook-doc-import touch-manipulation"
          onClick={onClose}
          disabled={busy}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="audiobook-doc-import touch-manipulation"
          onClick={() => void onConnect()}
          disabled={busy || !url.trim()}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {t('audiobooks.calibreWebConnect')}
        </button>
      </div>

      {connected ? (
        <p className="audiobook-doc-section">
          {t('audiobooks.calibreWebConnectedTo', { name: connected })}
        </p>
      ) : null}

      {books ? (
        <>
          <div className="flex gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSearch();
              }}
              placeholder={t('audiobooks.calibreWebSearchPlaceholder')}
              className="audiobook-doc-url-input flex-1"
              aria-label={t('audiobooks.calibreWebSearchPlaceholder')}
            />
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => void onSearch()}
              disabled={busy}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          {books.length === 0 ? (
            <p className="audiobook-doc-meta">{t('audiobooks.calibreWebNoResults')}</p>
          ) : null}

          <div className="space-y-1">
            {books.map((book) => (
              <div
                key={book.id}
                className="flex items-center gap-2 border border-[var(--border)] rounded-lg p-2"
              >
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt=""
                    className="w-8 h-12 object-cover rounded-sm shrink-0"
                    loading="lazy"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="audiobook-doc-name truncate">{book.title}</p>
                  <p className="audiobook-doc-meta truncate">
                    {[book.author, formatLabel(book.contentType)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  className="audiobook-doc-import touch-manipulation shrink-0"
                  onClick={() => void onDownload(book)}
                  disabled={busy || imported.has(book.id)}
                  aria-label={t('audiobooks.calibreWebDownload')}
                >
                  {imported.has(book.id) ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
