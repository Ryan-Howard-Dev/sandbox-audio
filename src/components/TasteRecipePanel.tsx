import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Link2, Share2, Upload } from 'lucide-react';
import {
  applyTasteRecipe,
  buildTasteShareUrl,
  copyTasteManifestToClipboard,
  downloadTasteManifestFile,
  exportSignedTasteRecipe,
  parseTasteManifestFromHash,
  parseTasteManifestJson,
  type SignedTasteManifest,
  type TasteManifestVerification,
  verifyTasteManifest,
} from '../tasteManifest';
import { getTier34BaseUrl, tier34FetchTasteManifest, tier34ShareTasteManifest } from '../tier34/client';

export type TasteRecipePanelProps = {
  stationName?: string;
  displayName?: string;
  /** Compact layout for Sonic Locker station header. */
  compact?: boolean;
  onApplied?: (result: {
    verification: TasteManifestVerification;
    playlistId?: string;
  }) => void;
};

export default function TasteRecipePanel({
  stationName = 'My taste station',
  displayName,
  compact = false,
  onApplied,
}: TasteRecipePanelProps) {
  const [status, setStatus] = useState('');
  const [importText, setImportText] = useState('');
  const [lastExport, setLastExport] = useState<SignedTasteManifest | null>(null);
  const [verification, setVerification] = useState<TasteManifestVerification | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    setStatus('Signing recipe…');
    try {
      const manifest = await exportSignedTasteRecipe({ stationName, displayName });
      setLastExport(manifest);
      const v = await verifyTasteManifest(manifest);
      setVerification(v);
      setShareUrl(buildTasteShareUrl(manifest));
      setStatus('Recipe exported — copy, download, or share via LAN.');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Export failed');
    }
  }, [displayName, stationName]);

  const runImport = useCallback(
    async (manifest: SignedTasteManifest, mode: 'merge' | 'new-station') => {
      setStatus('Verifying signature…');
      try {
        const result = await applyTasteRecipe(manifest, mode);
        setVerification(result.verification);
        setStatus(
          result.verification.valid
            ? `Applied · Shared by ${result.verification.provenanceLabel ?? 'verified signer'}`
            : 'Applied with invalid signature — treat as untrusted.',
        );
        onApplied?.({
          verification: result.verification,
          playlistId: result.playlistId,
        });
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Import failed');
      }
    },
    [onApplied],
  );

  const handleImportPaste = useCallback(async () => {
    const raw = importText.trim();
    if (!raw) {
      setStatus('Paste a signed taste JSON manifest first.');
      return;
    }
    try {
      const manifest = parseTasteManifestJson(raw);
      await runImport(manifest, 'merge');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed');
    }
  }, [importText, runImport]);

  const handleImportFile = useCallback(
    (file: File) => {
      setStatus('Reading file…');
      void file
        .text()
        .then((raw) => parseTasteManifestJson(raw))
        .then((manifest) => runImport(manifest, 'new-station'))
        .catch((err) => {
          setStatus(err instanceof Error ? err.message : 'Import failed');
        });
    },
    [runImport],
  );

  const handleLanShare = useCallback(async () => {
    const base = getTier34BaseUrl().trim();
    if (!base) {
      setStatus('Configure Sandbox Server URL in Settings to share on LAN.');
      return;
    }
    setStatus('Publishing to Sandbox Server…');
    try {
      const manifest = lastExport ?? (await exportSignedTasteRecipe({ stationName, displayName }));
      setLastExport(manifest);
      const row = await tier34ShareTasteManifest(manifest);
      const lanUrl = `${base.replace(/\/$/, '')}/api/taste/${row.id}`;
      setShareUrl(lanUrl);
      setStatus(`LAN share ready · id ${row.id}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'LAN share failed');
    }
  }, [displayName, lastExport, stationName]);

  const handleLanFetch = useCallback(async () => {
    const id = importText.trim();
    if (!/^[a-f0-9]{8,64}$/i.test(id)) {
      setStatus('Paste a taste share id (16-char hash) to fetch from LAN.');
      return;
    }
    setStatus('Fetching from Sandbox Server…');
    try {
      const row = await tier34FetchTasteManifest(id);
      if (!row?.manifest) throw new Error('Manifest not found on server.');
      const manifest = parseTasteManifestJson(JSON.stringify(row.manifest));
      await runImport(manifest, 'new-station');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'LAN fetch failed');
    }
  }, [importText, runImport]);

  useEffect(() => {
    const fromHash = parseTasteManifestFromHash(window.location.hash);
    if (!fromHash) return;
    void runImport(fromHash, 'merge').catch(() => {
      /* ignore auto-import errors */
    });
  }, [runImport]);

  return (
    <div className={`taste-recipe-panel space-y-3 ${compact ? '' : 'p-4 rounded-xl border border-[var(--border)]'}`}>
      {!compact ? (
        <div>
          <p className="font-mono text-xs uppercase">Federated taste recipes</p>
          <p className="ui-hint mt-1 text-[10px]">
            Export signed station recipes (genre weights, sonic prefs, artist seeds) — never audio
            files. Import merges affinity or creates a smart station.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleExport()}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation flex items-center gap-1.5 border-[var(--border)]"
        >
          <Share2 className="w-3.5 h-3.5" />
          Export recipe
        </button>
        {lastExport ? (
          <>
            <button
              type="button"
              onClick={() => {
                void copyTasteManifestToClipboard(lastExport).then(() =>
                  setStatus('JSON copied to clipboard.'),
                );
              }}
              className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation flex items-center gap-1.5 border-[var(--border)]"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy JSON
            </button>
            <button
              type="button"
              onClick={() => {
                downloadTasteManifestFile(lastExport);
                setStatus('Downloaded .sandbox-taste.json');
              }}
              className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation flex items-center gap-1.5 border-[var(--border)]"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => importRef.current?.click()}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation flex items-center gap-1.5 border-[var(--border)]"
        >
          <Upload className="w-3.5 h-3.5" />
          Import file
        </button>
        <button
          type="button"
          onClick={() => void handleLanShare()}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation flex items-center gap-1.5 border-[var(--border)]"
        >
          <Link2 className="w-3.5 h-3.5" />
          LAN share
        </button>
      </div>

      <textarea
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder="Paste signed JSON, or LAN share id…"
        rows={compact ? 2 : 3}
        className="w-full font-mono text-[11px] p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-void)]/40 resize-y min-h-[3rem]"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleImportPaste()}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation border-[var(--border)]"
        >
          Merge recipe
        </button>
        <button
          type="button"
          onClick={() => {
            const raw = importText.trim();
            if (!raw) return;
            try {
              const manifest = parseTasteManifestJson(raw);
              void runImport(manifest, 'new-station');
            } catch (err) {
              setStatus(err instanceof Error ? err.message : 'Import failed');
            }
          }}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation border-[var(--border)]"
        >
          New smart station
        </button>
        <button
          type="button"
          onClick={() => void handleLanFetch()}
          className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation border-[var(--border)]"
        >
          Fetch LAN id
        </button>
      </div>

      {verification?.valid ? (
        <p className="text-xs font-mono text-accent flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          Shared by {verification.provenanceLabel ?? 'verified signer'}
        </p>
      ) : verification ? (
        <p className="text-xs font-mono text-amber-500/90">Signature not verified</p>
      ) : null}

      {shareUrl ? (
        <p className="text-[10px] font-mono text-[var(--text-dim)] break-all select-all">{shareUrl}</p>
      ) : null}

      {status ? <p className="text-xs font-mono text-[var(--text-mid)]">{status}</p> : null}

      <input
        ref={importRef}
        type="file"
        accept=".sandbox-taste.json,application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handleImportFile(file);
        }}
      />
    </div>
  );
}
