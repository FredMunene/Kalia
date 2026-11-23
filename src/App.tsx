import { useCallback, useEffect, useRef, useState } from "react";
import { User } from "firebase/auth";
import {
  ApplicationLogEntry,
  DriveWorkspaceConfig,
  FactItem,
  GeneratedDocumentEntry,
  MasterCvMetadata,
  ProfileDefaults,
  SavedQA,
  SheetSyncConfig,
  TokenUsageSummary,
  UserStatsEntry,
  WorkspaceView,
} from "./types/career";
import { parseJobTrackerCsv } from "./utils/csvParser";
import {
  getAccessToken,
  googleSignIn,
  initAuth,
  isAdminUser,
  logout,
} from "./services/googleAuth";
import {
  batchCreateFactDocs,
  deleteApplicationDoc,
  deleteFactDoc,
  deleteGeneratedDocRecord,
  EMPTY_PROFILE,
  ensureUserWorkspaceDoc,
  recordUserStatsDelta,
  subscribeToAdminUserStats,
  subscribeToUserWorkspace,
  updateUserWorkspaceFields,
  upsertApplicationDoc,
  upsertFactDoc,
  upsertGeneratedDocRecord,
  UserWorkspaceDocData,
} from "./services/firestoreService";
import {
  provisionDriveWorkspace,
  pullTrackerFromSheet,
  pushTrackerToSheet,
} from "./services/googleWorkspace";
import { SignInLanding } from "./components/SignInLanding";
import { Sidebar } from "./components/Sidebar";
import { TopHeader } from "./components/TopHeader";
import { MasterCvView } from "./components/MasterCvView";
import { MyApplicationsView } from "./components/MyApplicationsView";
import { ExtensionConnectView } from "./components/ExtensionConnectView";
import { AdminUsageView } from "./components/AdminUsageView";
import { MemoryJoggerDrawer } from "./components/MemoryJoggerDrawer";
import { SheetSyncModal } from "./components/SheetSyncModal";
import { NewApplicationModal } from "./components/NewApplicationModal";
import { ConfirmDialog } from "./components/ConfirmDialog";

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>("master-cv");

  // Auth & Workspace State
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Per-User Firestore State
  const [workspaceData, setWorkspaceData] = useState<UserWorkspaceDocData | null>(null);
  const [facts, setFacts] = useState<FactItem[]>([]);
  const [applications, setApplications] = useState<ApplicationLogEntry[]>([]);
  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocumentEntry[]>([]);
  const [provisioningWorkspace, setProvisioningWorkspace] = useState(false);

  // Admin Telemetry State
  const [adminStats, setAdminStats] = useState<UserStatsEntry[]>([]);
  const [adminStatsLoading, setAdminStatsLoading] = useState(false);

  // Overlays & Selections
  const [drawerApp, setDrawerApp] = useState<ApplicationLogEntry | null>(null);
  const [studioRoleId, setStudioRoleId] = useState<string | null>(null);
  const [studioSubTab, setStudioSubTab] = useState<"tracker" | "studio">("tracker");
  const [sheetModalOpen, setSheetModalOpen] = useState(false);
  const [newAppModalOpen, setNewAppModalOpen] = useState(false);
  const [pendingPushConfig, setPendingPushConfig] = useState<SheetSyncConfig | null>(
    null
  );
  const [pushBusy, setPushBusy] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const autoProvisionedUidRef = useRef<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3400);
  }, []);

  // Warm up backend API on mount and tab visibility return
  useEffect(() => {
    const pingHealth = () => {
      fetch("/api/health").catch(() => {});
    };
    pingHealth();
    const onVisible = () => {
      if (document.visibilityState === "visible") pingHealth();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = initAuth(
      async (authedUser, token) => {
        setUser(authedUser);
        setAccessToken(token);
        setAuthReady(true);
        try {
          await ensureUserWorkspaceDoc(authedUser);
        } catch (err) {
          console.error("Failed to initialize user workspace:", err);
        }
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setWorkspaceData(null);
        setFacts([]);
        setApplications([]);
        setGeneratedDocs([]);
        setAdminStats([]);
        autoProvisionedUidRef.current = null;
        setAuthReady(true);
      }
    );
    return () => unsub();
  }, []);

  // Subscribe to signed-in user's isolated Firestore workspace
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToUserWorkspace(user.uid, {
      onWorkspace: setWorkspaceData,
      onFacts: setFacts,
      onApplications: setApplications,
      onGeneratedDocs: setGeneratedDocs,
    });
    return () => unsub();
  }, [user]);

  // Admin telemetry subscription (only for verified admin email)
  const admin = isAdminUser(user);
  useEffect(() => {
    if (!admin) return;
    setAdminStatsLoading(true);
    const unsub = subscribeToAdminUserStats((rows) => {
      setAdminStats(rows);
      setAdminStatsLoading(false);
    });
    return () => unsub();
  }, [admin]);

  const handleProvisionWorkspace = useCallback(async () => {
    if (!user) return;
    const token = accessToken || getAccessToken();
    if (!token) {
      showToast("Connect Google Drive first to set up your Drive workspace.");
      return;
    }
    setProvisioningWorkspace(true);
    try {
      const result = await provisionDriveWorkspace(token);
      const cleanWorkspace: DriveWorkspaceConfig = {
        rootFolderId: result.workspace.rootFolderId,
        rootFolderName: result.workspace.rootFolderName,
        rootFolderUrl: result.workspace.rootFolderUrl,
        trackersFolderId: result.workspace.trackersFolderId,
        cvsFolderId: result.workspace.cvsFolderId,
        coverLettersFolderId: result.workspace.coverLettersFolderId,
        sourcesFolderId: result.workspace.sourcesFolderId,
        createdAt: result.workspace.createdAt,
      };
      const cleanSheet: SheetSyncConfig = {
        spreadsheetId: result.sheetConfig.spreadsheetId,
        spreadsheetTitle: result.sheetConfig.spreadsheetTitle,
        spreadsheetUrl: result.sheetConfig.spreadsheetUrl,
        pipelineTab: result.sheetConfig.pipelineTab,
        logTab: result.sheetConfig.logTab,
        ...(result.sheetConfig.lastSyncedAt
          ? { lastSyncedAt: result.sheetConfig.lastSyncedAt }
          : {}),
      };
      await updateUserWorkspaceFields(user.uid, {
        workspaceConfig: cleanWorkspace,
        sheetConfig: cleanSheet,
      });
      await recordUserStatsDelta(user.uid, {
        email: user.email || "",
        displayName: user.displayName || "",
        driveWorkspaceLinked: true,
      });
      showToast(
        result.reusedExisting
          ? "Linked your existing CareerJogger Workspace folder in Google Drive."
          : "Created CareerJogger Workspace & Tracker Sheet in your Google Drive."
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to provision Google Drive workspace."
      );
    } finally {
      setProvisioningWorkspace(false);
    }
  }, [user, accessToken, showToast]);

  // Auto-provision Drive workspace once after Google sign-in if not linked yet
  useEffect(() => {
    if (!user || !accessToken || !workspaceData) return;
    if (workspaceData.workspaceConfig) return;
    if (autoProvisionedUidRef.current === user.uid) return;
    autoProvisionedUidRef.current = user.uid;
    handleProvisionWorkspace();
  }, [user, accessToken, workspaceData, handleProvisionWorkspace]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        await ensureUserWorkspaceDoc(result.user);
        showToast("Connected to Google Drive, Docs & Sheets.");
      }
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "Google Sign-In was cancelled or failed."
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setActiveView("master-cv");
    showToast("Signed out of CareerJogger.");
  };

  const handleRecordTokens = useCallback(
    async (usage?: TokenUsageSummary) => {
      if (!user || !usage || !usage.totalTokenCount) return;
      await recordUserStatsDelta(user.uid, {
        email: user.email || "",
        displayName: user.displayName || "",
        promptTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0,
      });
    },
    [user]
  );

  const handleSaveProfile = async (nextProfile: ProfileDefaults) => {
    if (!user) return;
    await updateUserWorkspaceFields(user.uid, { profile: nextProfile });
    showToast("Saved autofill profile.");
  };

  const handleUpdateMasterCv = async (cv: MasterCvMetadata) => {
    if (!user) return;
    await updateUserWorkspaceFields(user.uid, { masterCv: cv });
    await recordUserStatsDelta(user.uid, {
      email: user.email || "",
      displayName: user.displayName || "",
      masterCvUploaded: true,
    });
  };

  const handleAddFacts = async (newFacts: FactItem[]) => {
    if (!user || newFacts.length === 0) return;
    await batchCreateFactDocs(user.uid, newFacts);
  };

  const handleUpdateFact = async (fact: FactItem) => {
    if (!user) return;
    await upsertFactDoc(user.uid, fact);
  };

  const handleDeleteFact = async (factId: string) => {
    if (!user) return;
    await deleteFactDoc(user.uid, factId);
  };

  const handleUpsertApplication = async (entry: ApplicationLogEntry) => {
    if (!user) return;
    const { entry: saved, isNew } = await upsertApplicationDoc(user.uid, entry);
    if (isNew) {
      await recordUserStatsDelta(user.uid, {
        email: user.email || "",
        displayName: user.displayName || "",
        applicationCountAbsolute: applications.length + 1,
      });
    }
    if (drawerApp?.id === saved.id) {
      setDrawerApp(saved);
    }
  };

  const handleDeleteApplication = async (appId: string) => {
    if (!user) return;
    await deleteApplicationDoc(user.uid, appId);
    await recordUserStatsDelta(user.uid, {
      email: user.email || "",
      displayName: user.displayName || "",
      applicationCountAbsolute: Math.max(0, applications.length - 1),
    });
    showToast("Removed application entry.");
  };

  const handleImportCsv = async (csvText: string) => {
    if (!user) return;
    const parsed = parseJobTrackerCsv(csvText);
    const merged: ApplicationLogEntry[] = [
      ...parsed.applications,
      ...parsed.pipeline.map((p) => ({
        id: p.id,
        role: p.role,
        company: p.company,
        location: p.location,
        siteLink: p.applicationLink,
        deadline: p.nextActionDate,
        submissionDate: "",
        status: p.outreachStatus || "Not Applied",
        notes: [p.notes, p.nextAction].filter(Boolean).join(" · "),
        companyProfile: "",
        source: "CSV Import",
        otherLinks: "",
        interviewPrep: "",
        cvVersion: p.cvVersion,
        matchScore: p.matchScore,
      })),
    ];

    for (const item of merged.slice(0, 100)) {
      await upsertApplicationDoc(user.uid, item);
    }
    await recordUserStatsDelta(user.uid, {
      email: user.email || "",
      displayName: user.displayName || "",
      applicationCountAbsolute: applications.length + merged.length,
    });
    showToast(`Imported ${merged.length} application(s) into your workspace.`);
  };

  const handleSaveGeneratedDoc = async (docEntry: GeneratedDocumentEntry) => {
    if (!user) return;
    await upsertGeneratedDocRecord(user.uid, docEntry);
  };

  const handleDeleteGeneratedDoc = async (docId: string) => {
    if (!user) return;
    await deleteGeneratedDocRecord(user.uid, docId);
  };

  const handleSaveQAsToRole = async (roleId: string, newQAs: SavedQA[]) => {
    if (!user) return;
    const target = applications.find((a) => a.id === roleId);
    if (!target) return;
    const existing = target.savedQAs || [];
    const updated: ApplicationLogEntry = {
      ...target,
      savedQAs: [...newQAs, ...existing],
    };
    await upsertApplicationDoc(user.uid, updated);
    showToast("Saved drafted Q&As to role memory.");
  };

  const handleSetSheetConfig = async (cfg: SheetSyncConfig) => {
    if (!user) return;
    const cleanSheet: SheetSyncConfig = {
      spreadsheetId: cfg.spreadsheetId,
      spreadsheetTitle: cfg.spreadsheetTitle,
      spreadsheetUrl: cfg.spreadsheetUrl,
      pipelineTab: cfg.pipelineTab,
      logTab: cfg.logTab,
      ...(cfg.lastSyncedAt ? { lastSyncedAt: cfg.lastSyncedAt } : {}),
    };
    await updateUserWorkspaceFields(user.uid, { sheetConfig: cleanSheet });
  };

  const handleConfirmedPushToSheet = async () => {
    if (!user || !pendingPushConfig) return;
    const token = accessToken || getAccessToken();
    if (!token) {
      showToast("Connect Google Drive first to write to Google Sheets.");
      return;
    }
    setPushBusy(true);
    try {
      await pushTrackerToSheet(
        token,
        pendingPushConfig.spreadsheetId,
        pendingPushConfig.pipelineTab,
        pendingPushConfig.logTab,
        [],
        applications
      );
      await handleSetSheetConfig({
        ...pendingPushConfig,
        lastSyncedAt: new Date().toISOString(),
      });
      setPendingPushConfig(null);
      showToast(`Synced ${applications.length} application row(s) to Google Sheets.`);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to write to Google Sheet."
      );
    } finally {
      setPushBusy(false);
    }
  };

  const handlePullFromSheet = async (cfg: SheetSyncConfig) => {
    if (!user) return;
    const token = accessToken || getAccessToken();
    if (!token) throw new Error("Connect Google Drive first.");
    const data = await pullTrackerFromSheet(
      token,
      cfg.spreadsheetId,
      cfg.pipelineTab,
      cfg.logTab
    );
    for (const appItem of data.applications.slice(0, 100)) {
      await upsertApplicationDoc(user.uid, appItem);
    }
    await handleSetSheetConfig({
      ...cfg,
      lastSyncedAt: new Date().toISOString(),
    });
    showToast(`Pulled ${data.applications.length} application(s) from Google Sheet.`);
  };

  const handleMarkExtensionConnected = useCallback(async () => {
    if (!user) return;
    await updateUserWorkspaceFields(user.uid, {
      extensionConnectedAt: new Date().toISOString(),
    });
  }, [user]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-xs text-slate-500">
        Loading CareerJogger workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <SignInLanding
        onLogin={handleLogin}
        isLoggingIn={isLoggingIn}
        authError={authError}
      />
    );
  }

  const profile = workspaceData?.profile || EMPTY_PROFILE;
  const workspaceConfig = workspaceData?.workspaceConfig || null;
  const sheetConfig = workspaceData?.sheetConfig || null;
  const hasGoogleToken = Boolean(accessToken);

  return (
    <div className="flex min-h-screen bg-white text-slate-900">
      <Sidebar
        activeView={activeView}
        onSelectView={setActiveView}
        factsCount={facts.length}
        applicationsCount={applications.length}
        isAdmin={admin}
        hasGoogleToken={hasGoogleToken}
        sheetConfig={sheetConfig}
        workspace={workspaceConfig}
        provisioningWorkspace={provisioningWorkspace}
        onOpenSheetModal={() => setSheetModalOpen(true)}
        onProvisionWorkspace={handleProvisionWorkspace}
        onReconnectDrive={handleLogin}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader
          activeView={activeView}
          user={user}
          hasGoogleToken={hasGoogleToken}
          isReconnectingDrive={isLoggingIn}
          sheetConfig={sheetConfig}
          onReconnectDrive={handleLogin}
          onLogout={handleLogout}
          onOpenSheetModal={() => setSheetModalOpen(true)}
          onNewApplication={() => setNewAppModalOpen(true)}
        />

        {authError && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-700">
            {authError}
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-6 py-6">
          {activeView === "master-cv" && (
            <MasterCvView
              accessToken={accessToken}
              hasGoogleToken={hasGoogleToken}
              onReconnectDrive={handleLogin}
              workspace={workspaceConfig}
              sheetConfig={sheetConfig}
              provisioningWorkspace={provisioningWorkspace}
              onProvisionWorkspace={handleProvisionWorkspace}
              masterCv={workspaceData?.masterCv}
              onUpdateMasterCv={handleUpdateMasterCv}
              profile={profile}
              onSaveProfile={handleSaveProfile}
              facts={facts}
              onAddFacts={handleAddFacts}
              onUpdateFact={handleUpdateFact}
              onDeleteFact={handleDeleteFact}
              onRecordTokens={handleRecordTokens}
            />
          )}

          {activeView === "applications" && (
            <MyApplicationsView
              applications={applications}
              facts={facts}
              profile={profile}
              generatedDocs={generatedDocs}
              workspace={workspaceConfig}
              accessToken={accessToken}
              hasGoogleToken={hasGoogleToken}
              provisioningWorkspace={provisioningWorkspace}
              initialStudioRoleId={studioRoleId}
              initialSubTab={studioSubTab}
              onReconnectDrive={handleLogin}
              onProvisionWorkspace={handleProvisionWorkspace}
              onSelectEntry={(item) => setDrawerApp(item)}
              onUpdateApplication={handleUpsertApplication}
              onImportCsvFile={handleImportCsv}
              onSaveGeneratedDoc={handleSaveGeneratedDoc}
              onDeleteGeneratedDoc={handleDeleteGeneratedDoc}
              onSaveQAsToRole={handleSaveQAsToRole}
              onRecordTokens={handleRecordTokens}
              onOpenNewModal={() => setNewAppModalOpen(true)}
            />
          )}

          {activeView === "extension" && (
            <ExtensionConnectView
              profile={profile}
              facts={facts}
              applications={applications}
              documents={generatedDocs}
              extensionConnectedAt={workspaceData?.extensionConnectedAt}
              onMarkExtensionConnected={handleMarkExtensionConnected}
            />
          )}

          {activeView === "admin" && admin && (
            <AdminUsageView stats={adminStats} loading={adminStatsLoading} />
          )}
        </main>
      </div>

      {/* Slide-Over Memory Jogger Drawer */}
      <MemoryJoggerDrawer
        record={drawerApp ? { kind: "application", item: drawerApp } : null}
        onClose={() => setDrawerApp(null)}
        onUpdatePipeline={() => {}}
        onUpdateApplication={handleUpsertApplication}
        onDeletePipeline={() => {}}
        onDeleteApplication={handleDeleteApplication}
        onDraftForRole={(rec) => {
          setStudioRoleId(rec.item.id);
          setStudioSubTab("studio");
          setDrawerApp(null);
          setActiveView("applications");
        }}
      />

      {/* Google Sheets Sync Modal */}
      <SheetSyncModal
        open={sheetModalOpen}
        onClose={() => setSheetModalOpen(false)}
        needsAuth={!hasGoogleToken}
        accessToken={accessToken}
        onLogin={handleLogin}
        sheetConfig={sheetConfig}
        onSetSheetConfig={handleSetSheetConfig}
        onRequestPushToSheet={(cfg) => setPendingPushConfig(cfg)}
        onPullFromSheet={handlePullFromSheet}
      />

      {/* New Application Modal */}
      <NewApplicationModal
        open={newAppModalOpen}
        onClose={() => setNewAppModalOpen(false)}
        onAddApplication={async (entry) => {
          await handleUpsertApplication(entry);
          setStudioSubTab("tracker");
          setActiveView("applications");
          showToast(`Added ${entry.role} at ${entry.company}.`);
        }}
      />

      {/* Mandatory Confirmation Before Overwriting Google Sheet */}
      <ConfirmDialog
        open={Boolean(pendingPushConfig)}
        title="Overwrite Google Sheet tabs with workspace data?"
        description="This will replace the contents of your linked Google Sheet tabs with your current application records."
        details={
          pendingPushConfig
            ? [
                `Spreadsheet: ${pendingPushConfig.spreadsheetTitle}`,
                `Applications Log Tab (${pendingPushConfig.logTab}): ${applications.length} row(s)`,
              ]
            : []
        }
        confirmLabel="Push to Google Sheet"
        busy={pushBusy}
        onConfirm={handleConfirmedPushToSheet}
        onCancel={() => setPendingPushConfig(null)}
      />

      {/* Ephemeral Feedback Toast */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 rounded-md border border-slate-200 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
