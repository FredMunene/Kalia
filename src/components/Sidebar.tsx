import React from "react";
import {
  FileBadge,
  Briefcase,
  Puzzle,
  BarChart3,
  ExternalLink,
  Sheet,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import {
  DriveWorkspaceConfig,
  SheetSyncConfig,
  WorkspaceView,
} from "../types/career";

interface SidebarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  factsCount: number;
  applicationsCount: number;
  isAdmin: boolean;
  hasGoogleToken: boolean;
  sheetConfig: SheetSyncConfig | null;
  workspace: DriveWorkspaceConfig | null;
  provisioningWorkspace: boolean;
  onOpenSheetModal: () => void;
  onProvisionWorkspace: () => void;
  onReconnectDrive: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onSelectView,
  factsCount,
  applicationsCount,
  isAdmin,
  hasGoogleToken,
  sheetConfig,
  workspace,
  provisioningWorkspace,
  onOpenSheetModal,
  onProvisionWorkspace,
  onReconnectDrive,
}) => {
  const navItems: Array<{
    id: WorkspaceView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: "master-cv", label: "Master CV", icon: FileBadge, count: factsCount },
    { id: "applications", label: "My Applications", icon: Briefcase, count: applicationsCount },
    { id: "extension", label: "Extension", icon: Puzzle },
  ];

  if (isAdmin) {
    navItems.push({ id: "admin", label: "Admin Usage", icon: BarChart3 });
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50/70">
      <div className="flex h-14 items-center border-b border-slate-200 px-5">
        <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
          CareerJogger
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Primary">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? "bg-white font-semibold text-slate-900 shadow-xs ring-1 ring-slate-200"
                  : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate whitespace-nowrap">{item.label}</span>
              </span>
              {typeof item.count === "number" && (
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-4 space-y-3 text-xs">
        <div>
          <div className="font-medium text-slate-700">Your Drive Workspace</div>
          {workspace ? (
            <div className="mt-1 space-y-1">
              <a
                href={workspace.rootFolderUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-slate-900 hover:underline"
              >
                <span className="truncate max-w-[165px]">{workspace.rootFolderName}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              {!hasGoogleToken && (
                <button
                  type="button"
                  onClick={onReconnectDrive}
                  className="block text-[11px] font-medium text-amber-700 underline decoration-amber-300 hover:text-amber-900"
                >
                  Refresh Drive session
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={hasGoogleToken ? onProvisionWorkspace : onReconnectDrive}
              disabled={provisioningWorkspace}
              className="mt-1.5 inline-flex items-center gap-1.5 font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
            >
              {provisioningWorkspace ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderPlus className="h-3.5 w-3.5" />
              )}
              {provisioningWorkspace
                ? "Setting up Drive..."
                : hasGoogleToken
                ? "Setup Drive Workspace"
                : "Connect Drive Storage"}
            </button>
          )}
        </div>

        <div className="pt-2 border-t border-slate-200/80">
          <div className="font-medium text-slate-700">Tracker Google Sheet</div>
          {sheetConfig ? (
            <div className="mt-1 space-y-1">
              <div className="truncate font-medium text-slate-900">
                {sheetConfig.spreadsheetTitle}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onOpenSheetModal}
                  className="text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                >
                  Sync
                </button>
                <a
                  href={sheetConfig.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenSheetModal}
              className="mt-1.5 inline-flex items-center gap-1.5 font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
            >
              <Sheet className="h-3.5 w-3.5" />
              Link or create Sheet
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
