import React, { useState } from "react";
import { X, Sheet, ArrowDownToLine, ArrowUpFromLine, ExternalLink } from "lucide-react";
import { SheetSyncConfig } from "../types/career";
import {
  createTrackerSpreadsheet,
  extractSpreadsheetId,
  getSpreadsheetMetadata,
} from "../services/googleWorkspace";
import { GoogleSignInButton } from "./GoogleSignInButton";

interface SheetSyncModalProps {
  open: boolean;
  onClose: () => void;
  needsAuth: boolean;
  accessToken: string | null;
  onLogin: () => void;
  sheetConfig: SheetSyncConfig | null;
  onSetSheetConfig: (cfg: SheetSyncConfig) => void;
  onRequestPushToSheet: (cfg: SheetSyncConfig) => void;
  onPullFromSheet: (cfg: SheetSyncConfig) => Promise<void>;
}

export const SheetSyncModal: React.FC<SheetSyncModalProps> = ({
  open,
  onClose,
  needsAuth,
  accessToken,
  onLogin,
  sheetConfig,
  onSetSheetConfig,
  onRequestPushToSheet,
  onPullFromSheet,
}) => {
  const [sheetInput, setSheetInput] = useState(
    sheetConfig?.spreadsheetUrl || ""
  );
  const [newSheetTitle, setNewSheetTitle] = useState("CareerJogger Job Tracker");
  const [availableTabs, setAvailableTabs] = useState<string[]>(
    sheetConfig ? [sheetConfig.pipelineTab, sheetConfig.logTab] : []
  );
  const [pipelineTab, setPipelineTab] = useState(
    sheetConfig?.pipelineTab || "Target Pipeline"
  );
  const [logTab, setLogTab] = useState(
    sheetConfig?.logTab || "Applications Log"
  );
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleConnectExisting = async () => {
    if (!accessToken || !sheetInput.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const id = extractSpreadsheetId(sheetInput);
      const meta = await getSpreadsheetMetadata(accessToken, id);
      setAvailableTabs(meta.tabs);
      const pTab = meta.tabs.includes("Target Pipeline")
        ? "Target Pipeline"
        : meta.tabs[0] || "Target Pipeline";
      const lTab = meta.tabs.includes("Applications Log")
        ? "Applications Log"
        : meta.tabs[1] || meta.tabs[0] || "Applications Log";
      setPipelineTab(pTab);
      setLogTab(lTab);
      const cfg: SheetSyncConfig = {
        spreadsheetId: meta.spreadsheetId,
        spreadsheetTitle: meta.title,
        spreadsheetUrl: meta.spreadsheetUrl,
        pipelineTab: pTab,
        logTab: lTab,
      };
      onSetSheetConfig(cfg);
      setInfoMsg(`Connected to "${meta.title}" (${meta.tabs.length} tab(s)).`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not read Google Sheet."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCreateNew = async () => {
    if (!accessToken) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const meta = await createTrackerSpreadsheet(
        accessToken,
        newSheetTitle.trim() || "CareerJogger Job Tracker"
      );
      setAvailableTabs(meta.tabs);
      setPipelineTab("Target Pipeline");
      setLogTab("Applications Log");
      const cfg: SheetSyncConfig = {
        spreadsheetId: meta.spreadsheetId,
        spreadsheetTitle: meta.title,
        spreadsheetUrl: meta.spreadsheetUrl,
        pipelineTab: "Target Pipeline",
        logTab: "Applications Log",
      };
      onSetSheetConfig(cfg);
      setSheetInput(meta.spreadsheetUrl);
      setInfoMsg(`Created new spreadsheet "${meta.title}". Click "Push Workspace to Sheet" to populate your tracker rows.`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Could not create Google Sheet."
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePull = async () => {
    if (!sheetConfig) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const updatedCfg = { ...sheetConfig, pipelineTab, logTab };
      onSetSheetConfig(updatedCfg);
      await onPullFromSheet(updatedCfg);
      setInfoMsg("Pulled latest rows from Google Sheet.");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to pull from Google Sheet."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <Sheet className="h-5 w-5 text-emerald-700" />
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900">
                Google Sheets Two-Way Sync
              </h3>
              <p className="text-xs text-slate-500">
                Persist your Target Pipeline and Applications Log in a Google Sheet.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {needsAuth ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-5 text-center space-y-3">
            <p className="text-xs text-slate-600">
              Sign in with Google to connect an existing Google Sheet or create a new two-tab tracker spreadsheet.
            </p>
            <div className="flex justify-center">
              <GoogleSignInButton onClick={onLogin} />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {errorMsg && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {infoMsg}
              </div>
            )}

            {/* Option A: Connect Existing */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-800">
                Link Existing Google Sheet (URL or ID)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sheetInput}
                  onChange={(e) => setSheetInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
                <button
                  type="button"
                  onClick={handleConnectExisting}
                  disabled={busy || !sheetInput.trim()}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  Inspect Sheet
                </button>
              </div>
            </div>

            {/* Option B: Create New */}
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <label className="block text-xs font-semibold text-slate-800">
                Or Create a New Formatted Tracker Spreadsheet
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSheetTitle}
                  onChange={(e) => setNewSheetTitle(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                />
                <button
                  type="button"
                  onClick={handleCreateNew}
                  disabled={busy}
                  className="rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                >
                  Create Sheet
                </button>
              </div>
            </div>

            {sheetConfig && (
              <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      {sheetConfig.spreadsheetTitle}
                    </div>
                    {sheetConfig.lastSyncedAt && (
                      <div className="text-[11px] text-slate-500">
                        Last synced: {new Date(sheetConfig.lastSyncedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <a
                    href={sheetConfig.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 underline"
                  >
                    Open Sheet <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-600">
                      Target Pipeline Tab
                    </label>
                    {availableTabs.length > 0 ? (
                      <select
                        value={pipelineTab}
                        onChange={(e) => setPipelineTab(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {availableTabs.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {!availableTabs.includes("Target Pipeline") && (
                          <option value="Target Pipeline">Target Pipeline (create)</option>
                        )}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={pipelineTab}
                        onChange={(e) => setPipelineTab(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block font-medium text-slate-600">
                      Applications Log Tab
                    </label>
                    {availableTabs.length > 0 ? (
                      <select
                        value={logTab}
                        onChange={(e) => setLogTab(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {availableTabs.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                        {!availableTabs.includes("Applications Log") && (
                          <option value="Applications Log">Applications Log (create)</option>
                        )}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={logTab}
                        onChange={(e) => setLogTab(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handlePull}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    Pull from Sheet
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onRequestPushToSheet({
                        ...sheetConfig,
                        pipelineTab,
                        logTab,
                      })
                    }
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                    Push Workspace to Sheet
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
