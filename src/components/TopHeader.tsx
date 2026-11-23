import React from "react";
import { User } from "firebase/auth";
import { Plus, Sheet, LogOut, RefreshCw, CheckCircle2 } from "lucide-react";
import { SheetSyncConfig, WorkspaceView } from "../types/career";

interface TopHeaderProps {
  activeView: WorkspaceView;
  user: User;
  hasGoogleToken: boolean;
  isReconnectingDrive: boolean;
  sheetConfig: SheetSyncConfig | null;
  onReconnectDrive: () => void;
  onLogout: () => void;
  onOpenSheetModal: () => void;
  onNewApplication: () => void;
}

const VIEW_LABELS: Record<WorkspaceView, string> = {
  "master-cv": "Master CV & Fact Vault",
  applications: "My Applications & Tailored Docs",
  extension: "Chrome Extension Setup & Sync",
  admin: "Admin Usage & Token Telemetry",
};

export const TopHeader: React.FC<TopHeaderProps> = ({
  activeView,
  user,
  hasGoogleToken,
  isReconnectingDrive,
  sheetConfig,
  onReconnectDrive,
  onLogout,
  onOpenSheetModal,
  onNewApplication,
}) => {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-slate-200 bg-white px-6">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <span className="text-slate-400 whitespace-nowrap shrink-0">CareerJogger</span>
        <span className="text-slate-300" aria-hidden="true">/</span>
        <h1 className="font-display font-semibold text-slate-900 truncate">
          {VIEW_LABELS[activeView]}
        </h1>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        {hasGoogleToken ? (
          <span className="hidden md:inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 whitespace-nowrap">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
            Drive Connected
          </span>
        ) : (
          <button
            type="button"
            onClick={onReconnectDrive}
            disabled={isReconnectingDrive}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isReconnectingDrive ? "animate-spin" : ""}`} />
            {isReconnectingDrive ? "Connecting..." : "Reconnect Drive"}
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSheetModal}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
        >
          <Sheet className="h-3.5 w-3.5 text-emerald-700" />
          {sheetConfig ? "Sheet Sync" : "Link Sheet"}
        </button>

        <span className="hidden lg:inline truncate max-w-[180px] text-xs text-slate-500">
          {user.email}
        </span>

        <button
          type="button"
          onClick={onLogout}
          title="Sign out"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={onNewApplication}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          New Application
        </button>
      </div>
    </header>
  );
};
