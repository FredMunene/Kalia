import React, { useEffect, useState } from "react";
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  Puzzle,
  Link2,
  Copy,
  Check,
  RefreshCw,
} from "lucide-react";
import {
  ApplicationLogEntry,
  FactItem,
  GeneratedDocumentEntry,
  ProfileDefaults,
} from "../types/career";
import { generateChromeExtensionZip } from "../services/extensionGenerator";
import { getExtensionSessionPayload } from "../services/googleAuth";
import firebaseConfig from "../../firebase-applet-config.json";

interface ExtensionConnectViewProps {
  profile: ProfileDefaults;
  facts: FactItem[];
  applications: ApplicationLogEntry[];
  documents: GeneratedDocumentEntry[];
  extensionConnectedAt?: string;
  onMarkExtensionConnected: () => Promise<void>;
}

export const ExtensionConnectView: React.FC<ExtensionConnectViewProps> = ({
  profile,
  facts,
  applications,
  documents,
  extensionConnectedAt,
  onMarkExtensionConnected,
}) => {
  const [apiBaseUrl] = useState(
    typeof window !== "undefined" ? window.location.origin : ""
  );
  const [building, setBuilding] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const [extensionDetected, setExtensionDetected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.data) return;
      if (event.data.type === "CJ_WEB_PONG") {
        setExtensionDetected(true);
      }
      if (event.data.type === "CJ_WEB_AUTH_SYNC_ACK") {
        setSyncing(false);
        if (event.data.ok) {
          setExtensionDetected(true);
          setSyncMessage(
            `Extension synced with ${event.data.email || "your account"}. Future Master CV updates sync automatically.`
          );
          onMarkExtensionConnected().catch(() => {});
        } else {
          setSyncError(event.data.error || "Extension sync failed.");
        }
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "CJ_WEB_PING" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [onMarkExtensionConnected]);

  const handleDownload = async () => {
    setBuilding(true);
    try {
      const blob = await generateChromeExtensionZip({
        apiBaseUrl,
        includeLiveAi: true,
        profile,
        facts,
        applications,
        documents,
        firebaseConfig: {
          apiKey: firebaseConfig.apiKey,
          projectId: firebaseConfig.projectId,
          firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || "(default)",
        },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "CareerJogger-Chrome-Extension.zip";
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTimeout(() => setDownloaded(false), 3000);
    } finally {
      setBuilding(false);
    }
  };

  const handleConnectExtension = async () => {
    setSyncError(null);
    setSyncMessage(null);
    setSyncing(true);
    try {
      const payload = await getExtensionSessionPayload();
      window.postMessage({ type: "CJ_WEB_AUTH_SYNC", payload }, "*");

      // Fallback timeout if extension isn't installed or active on this frame yet
      setTimeout(() => {
        setSyncing((still) => {
          if (still) {
            setSyncError(
              "No extension response yet. Install the ZIP via chrome://extensions first, reload this tab, or use Copy Connection Key below."
            );
          }
          return false;
        });
      }, 1500);
    } catch (err) {
      setSyncing(false);
      setSyncError(
        err instanceof Error ? err.message : "Could not build extension session."
      );
    }
  };

  const handleCopyConnectionKey = async () => {
    setSyncError(null);
    try {
      const payload = await getExtensionSessionPayload();
      const key = btoa(JSON.stringify(payload));
      await navigator.clipboard.writeText(key);
      setCopiedKey(true);
      onMarkExtensionConnected().catch(() => {});
      setTimeout(() => setCopiedKey(false), 2500);
    } catch (err) {
      setSyncError(
        err instanceof Error ? err.message : "Could not copy connection key."
      );
    }
  };

  const profilePopulatedCount = Object.values(profile).filter(
    (v) => v.trim() !== ""
  ).length;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Install Once + Live Account Sync */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 space-y-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div className="space-y-2 max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <Puzzle className="h-3.5 w-3.5" />
              <span>Install Once · Account-Synced Extension</span>
            </div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Install & Connect Your Chrome Extension
            </h2>
            <p className="text-sm leading-relaxed text-slate-600">
              Download and load the extension once. Whenever you update your Master CV, add career facts, or sign in with Google Drive, click <span className="font-medium text-slate-900">Connect Extension</span> to keep it synced automatically.
            </p>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              disabled={building}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="h-4 w-4" />
              {building
                ? "Packaging ZIP..."
                : downloaded
                ? "Extension Downloaded"
                : "1. Download Extension (.zip)"}
            </button>

            <button
              type="button"
              onClick={handleConnectExtension}
              disabled={syncing}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400 whitespace-nowrap"
            >
              {syncing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {syncing ? "Syncing..." : "2. Connect Extension to Account"}
            </button>

            <button
              type="button"
              onClick={handleCopyConnectionKey}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              {copiedKey ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" /> Connection Key Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy Manual Connection Key
                </>
              )}
            </button>
          </div>
        </div>

        {syncMessage && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {syncMessage}
          </div>
        )}

        {syncError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
            {syncError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-5 sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Sync Status</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900">
              {extensionDetected || extensionConnectedAt
                ? "Connected"
                : "Not synced yet"}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Autofill Profile Fields</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {profilePopulatedCount} / 11 ready
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Synced Master Facts</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {facts.length} facts
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Drive CV / Cover Docs</div>
            <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
              {documents.length} doc(s)
            </div>
          </div>
        </div>
      </section>

      {/* Instructions & Extension Capabilities */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="font-display text-base font-semibold text-slate-900">
            First-Time Browser Setup
          </h3>
          <ol className="space-y-2.5 text-sm text-slate-700 list-decimal list-inside">
            <li>
              Unzip <span className="font-mono text-xs">CareerJogger-Chrome-Extension.zip</span> into a permanent folder.
            </li>
            <li>
              Open <span className="font-mono text-xs">chrome://extensions</span> and turn on <span className="font-semibold">Developer mode</span>.
            </li>
            <li>
              Click <span className="font-semibold">Load unpacked</span> and select the unzipped folder.
            </li>
            <li>
              Return here, reload this page once, and click <span className="font-semibold">Connect Extension to Account</span> (or paste the Connection Key inside the extension popup).
            </li>
          </ol>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="font-display text-base font-semibold text-slate-900">
            What Happens on Any Job Website
          </h3>
          <ul className="space-y-2.5 text-xs leading-relaxed text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong className="text-slate-900">Auto-Fill Profile Fields:</strong> Fills name, email, phone, location, LinkedIn, GitHub, portfolio, X, and work authorization in 1 click.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong className="text-slate-900">Draft & Fill Questions for Review:</strong> Reads custom ATS/form questions on the page, drafts answers grounded in your Master CV, and fills every box so you can review before submitting.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                <strong className="text-slate-900">Attach Drive PDFs & Log to Sheet:</strong> Exports your Master CV or tailored Google Docs as real PDFs into file upload slots and logs submitted apps straight to your Google Sheet tracker.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong className="text-slate-900">Human Final Submit:</strong> Captchas and final submit clicks remain yours so every application goes out accurately.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
};
