import React, { useRef, useState } from "react";
import {
  Upload,
  Sparkles,
  FileText,
  FolderOpen,
  ExternalLink,
  CheckCircle2,
  Plus,
  Trash2,
  RefreshCw,
  Download,
  FolderPlus,
  Save,
} from "lucide-react";
import {
  DriveFileEntry,
  DriveWorkspaceConfig,
  FactCategory,
  FactItem,
  MasterCvMetadata,
  ProfileDefaults,
  SheetSyncConfig,
  TokenUsageSummary,
} from "../types/career";
import {
  createFormattedGoogleDoc,
  DocBlock,
  downloadDriveFileForExtraction,
  exportGoogleDocAsPdf,
  extractDriveFolderId,
  listDriveFolderFiles,
  overwriteFormattedGoogleDoc,
  uploadSourceFileToDrive,
  upsertDriveJsonFile,
} from "../services/googleWorkspace";
import {
  extractTextFromDocxBuffer,
  extractTextFromPdfBuffer,
} from "../utils/documentTextExtractor";
import { parsePlainTextLocallyWithoutAi } from "../utils/starterFactsFromCsv";
import { postJson } from "../utils/safeFetch";
import { ConfirmDialog } from "./ConfirmDialog";

interface MasterCvViewProps {
  accessToken: string | null;
  hasGoogleToken: boolean;
  onReconnectDrive: () => void;
  workspace: DriveWorkspaceConfig | null;
  sheetConfig: SheetSyncConfig | null;
  provisioningWorkspace: boolean;
  onProvisionWorkspace: () => Promise<void>;
  masterCv?: MasterCvMetadata;
  onUpdateMasterCv: (cv: MasterCvMetadata) => Promise<void>;
  profile: ProfileDefaults;
  onSaveProfile: (profile: ProfileDefaults) => Promise<void>;
  facts: FactItem[];
  onAddFacts: (newFacts: FactItem[]) => Promise<void>;
  onUpdateFact: (fact: FactItem) => Promise<void>;
  onDeleteFact: (id: string) => Promise<void>;
  onRecordTokens: (usage?: TokenUsageSummary) => Promise<void>;
}

const CATEGORIES: FactCategory[] = [
  "Identity & Links",
  "Experience",
  "Projects",
  "Hackathons & Wins",
  "Speaking & DevRel",
  "Education & Certs",
];

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export const MasterCvView: React.FC<MasterCvViewProps> = ({
  accessToken,
  hasGoogleToken,
  onReconnectDrive,
  workspace,
  sheetConfig,
  provisioningWorkspace,
  onProvisionWorkspace,
  masterCv,
  onUpdateMasterCv,
  profile,
  onSaveProfile,
  facts,
  onAddFacts,
  onUpdateFact,
  onDeleteFact,
  onRecordTokens,
}) => {
  const [localProfile, setLocalProfile] = useState<ProfileDefaults>(profile);
  const [profileDirty, setProfileDirty] = useState(false);

  // Sync incoming Firestore profile updates when user isn't actively editing
  React.useEffect(() => {
    if (!profileDirty) {
      setLocalProfile(profile);
    }
  }, [profile, profileDirty]);

  const [useAiOnUpload, setUseAiOnUpload] = useState(true);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [pastedLabel, setPastedLabel] = useState("Master CV");
  const [driveFolderInput, setDriveFolderInput] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFileEntry[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);

  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Manual fact creation
  const [newCategory, setNewCategory] = useState<FactCategory>("Experience");
  const [newTitle, setNewTitle] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [newMetrics, setNewMetrics] = useState("");

  // Confirm overwrite of Master CV Google Doc
  const [pendingOverwriteMasterDoc, setPendingOverwriteMasterDoc] = useState<{
    docId: string;
    blocks: DocBlock[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildMasterCvBlocks = (
    prof: ProfileDefaults,
    factList: FactItem[]
  ): DocBlock[] => {
    const contactLine = [
      prof.email,
      prof.phone,
      prof.location,
      prof.linkedinUrl,
      prof.githubUrl,
      prof.portfolioUrl,
    ]
      .filter(Boolean)
      .join(" · ");

    const blocks: DocBlock[] = [
      { text: prof.fullName || "Master CV", style: "TITLE" },
      { text: contactLine || "Candidate Contact", style: "SUBTITLE" },
    ];

    if (prof.headline.trim()) {
      blocks.push({ text: "SUMMARY", style: "HEADING_2" });
      blocks.push({ text: prof.headline.trim(), style: "BODY" });
    }

    const grouped = new Map<string, FactItem[]>();
    for (const f of factList) {
      const list = grouped.get(f.category) || [];
      list.push(f);
      grouped.set(f.category, list);
    }

    for (const [cat, items] of grouped.entries()) {
      blocks.push({ text: cat.toUpperCase(), style: "HEADING_2" });
      for (const item of items) {
        blocks.push({
          text: `${item.title}: ${item.detail}${
            item.metrics ? ` (${item.metrics})` : ""
          }`,
          style: "BULLET",
        });
      }
    }
    return blocks;
  };

  const syncMasterFactsToDrive = async (
    nextProfile: ProfileDefaults,
    nextFacts: FactItem[],
    nextCvMeta?: Partial<MasterCvMetadata>
  ): Promise<string | undefined> => {
    if (!accessToken || !workspace?.sourcesFolderId) return masterCv?.factsFileId;
    const savedJson = await upsertDriveJsonFile(accessToken, {
      fileId: masterCv?.factsFileId,
      name: "Master_Facts_&_Profile.json",
      parentFolderId: workspace.sourcesFolderId,
      data: {
        updatedAt: new Date().toISOString(),
        profile: nextProfile,
        facts: nextFacts,
        masterCv: nextCvMeta || masterCv || null,
      },
    });
    return savedJson.id;
  };

  const ingestExtractedText = async (opts: {
    fileName: string;
    mimeType: string;
    textContent?: string;
    base64Data?: string;
    uploadedDriveFile?: { id: string; webViewLink: string };
    useAi: boolean;
  }) => {
    let nextProfile = { ...localProfile };
    let newFacts: FactItem[] = [];

    if (opts.useAi) {
      setBusyMsg(`Analyzing "${opts.fileName}" with AI...`);
      const data = await postJson<{
        profile?: Partial<ProfileDefaults>;
        facts?: Partial<FactItem>[];
        usage?: TokenUsageSummary;
      }>("/api/ai/extract-facts", {
        files: [
          {
            id: `master-${Date.now()}`,
            name: opts.fileName,
            mimeType: opts.mimeType,
            textContent: opts.textContent,
            base64Data: opts.base64Data,
          },
        ],
      });

      if (data.usage) {
        await onRecordTokens(data.usage);
      }

      if (data.profile) {
        nextProfile = {
          fullName: data.profile.fullName || nextProfile.fullName,
          email: data.profile.email || nextProfile.email,
          phone: data.profile.phone || nextProfile.phone,
          location: data.profile.location || nextProfile.location,
          headline: data.profile.headline || nextProfile.headline,
          linkedinUrl: data.profile.linkedinUrl || nextProfile.linkedinUrl,
          githubUrl: data.profile.githubUrl || nextProfile.githubUrl,
          portfolioUrl: data.profile.portfolioUrl || nextProfile.portfolioUrl,
          xUrl: data.profile.xUrl || nextProfile.xUrl,
          workAuth: data.profile.workAuth || nextProfile.workAuth,
          yearsExperience:
            data.profile.yearsExperience || nextProfile.yearsExperience,
        };
      }

      newFacts = (data.facts || []).map((f, idx) => ({
        id: `fact_${Date.now()}_${idx}`,
        category: CATEGORIES.includes(f.category as FactCategory)
          ? (f.category as FactCategory)
          : "Experience",
        title: f.title || "CV Fact",
        detail: f.detail || "",
        metrics: f.metrics || "",
        sourceFileId: opts.uploadedDriveFile?.id || "",
        sourceFileName: opts.fileName,
        verified: true,
        updatedAt: new Date().toISOString(),
      }));
    } else if (opts.textContent) {
      setBusyMsg(`Parsing "${opts.fileName}" locally...`);
      const parsed = parsePlainTextLocallyWithoutAi(
        opts.textContent,
        opts.fileName
      );
      nextProfile = {
        ...nextProfile,
        ...Object.fromEntries(
          Object.entries(parsed.profile).filter(([, v]) => Boolean(v))
        ),
      };
      newFacts = parsed.facts.map((f, idx) => ({
        ...f,
        id: `fact_local_${Date.now()}_${idx}`,
        sourceFileId: opts.uploadedDriveFile?.id || "",
      }));
    }

    setLocalProfile(nextProfile);
    setProfileDirty(false);
    await onSaveProfile(nextProfile);

    if (newFacts.length > 0) {
      await onAddFacts(newFacts);
    }

    const mergedFacts = [...newFacts, ...facts];
    let googleDocId = masterCv?.googleDocId;
    let googleDocUrl = masterCv?.googleDocUrl;

    if (accessToken && workspace?.sourcesFolderId && !googleDocId) {
      setBusyMsg("Creating Master CV Google Doc in your Drive workspace...");
      const doc = await createFormattedGoogleDoc(accessToken, {
        title: `${nextProfile.fullName || "Candidate"} — Master CV`,
        parentFolderId: workspace.sourcesFolderId,
        blocks: buildMasterCvBlocks(nextProfile, mergedFacts),
      });
      googleDocId = doc.documentId;
      googleDocUrl = doc.webViewLink;
    }

    const factsFileId = await syncMasterFactsToDrive(nextProfile, mergedFacts);

    const updatedMasterMeta: MasterCvMetadata = {
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      googleDocId: googleDocId || "",
      googleDocUrl: googleDocUrl || "",
      driveFileId: opts.uploadedDriveFile?.id || masterCv?.driveFileId || "",
      driveFileUrl:
        opts.uploadedDriveFile?.webViewLink || masterCv?.driveFileUrl || "",
      factsFileId: factsFileId || "",
      rawTextPreview: (opts.textContent || "").slice(0, 12000),
      updatedAt: new Date().toISOString(),
    };

    await onUpdateMasterCv(updatedMasterMeta);

    setStatusMsg(
      `Master CV "${opts.fileName}" saved${
        accessToken && workspace ? " to your Google Drive workspace" : ""
      } with ${newFacts.length} verified fact(s).`
    );
  };

  const handleLocalFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyMsg(`Reading ${file.name}...`);

    try {
      let uploadedDriveFile: { id: string; webViewLink: string } | undefined;
      if (accessToken && workspace?.sourcesFolderId) {
        setBusyMsg(`Uploading ${file.name} to your Google Drive workspace...`);
        const up = await uploadSourceFileToDrive(accessToken, {
          file,
          parentFolderId: workspace.sourcesFolderId,
        });
        uploadedDriveFile = { id: up.id, webViewLink: up.webViewLink };
      }

      let textContent = "";
      let base64Data: string | undefined;
      let mimeType = file.type || "text/plain";

      if (
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf")
      ) {
        const buf = await file.arrayBuffer();
        try {
          textContent = await extractTextFromPdfBuffer(buf);
        } catch {
          textContent = "";
        }
        if (textContent.length < 80) {
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunk = 0x8000;
          for (let j = 0; j < bytes.length; j += chunk) {
            binary += String.fromCharCode(...bytes.subarray(j, j + chunk));
          }
          base64Data = btoa(binary);
          mimeType = "application/pdf";
        } else {
          mimeType = "text/plain";
        }
      } else if (file.name.toLowerCase().endsWith(".docx")) {
        const buf = await file.arrayBuffer();
        textContent = await extractTextFromDocxBuffer(buf);
        mimeType = "text/plain";
      } else {
        textContent = await file.text();
        mimeType = "text/plain";
      }

      await ingestExtractedText({
        fileName: file.name,
        mimeType,
        textContent,
        base64Data,
        uploadedDriveFile,
        useAi: useAiOnUpload || Boolean(base64Data),
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to process Master CV file."
      );
    } finally {
      setBusyMsg(null);
      e.target.value = "";
    }
  };

  const handlePasteSubmit = async (withAi: boolean) => {
    if (!pastedText.trim()) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await ingestExtractedText({
        fileName: pastedLabel.trim() || "Master CV",
        mimeType: "text/plain",
        textContent: pastedText.trim(),
        useAi: withAi,
      });
      setPastedText("");
      setShowPasteBox(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to parse Master CV text."
      );
    } finally {
      setBusyMsg(null);
    }
  };

  const handleLoadDriveFolder = async () => {
    if (!accessToken) {
      onReconnectDrive();
      return;
    }
    setErrorMsg(null);
    setLoadingDrive(true);
    try {
      const folderId = driveFolderInput.trim()
        ? extractDriveFolderId(driveFolderInput)
        : workspace?.sourcesFolderId || "root";
      const list = await listDriveFolderFiles(accessToken, folderId);
      setDriveFiles(list);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to list Google Drive files."
      );
    } finally {
      setLoadingDrive(false);
    }
  };

  const handleImportDriveFile = async (file: DriveFileEntry) => {
    if (!accessToken) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setBusyMsg(`Importing ${file.name} from Google Drive...`);
    try {
      const downloaded = await downloadDriveFileForExtraction(accessToken, file);
      await ingestExtractedText({
        fileName: file.name,
        mimeType: downloaded.mimeType,
        textContent: downloaded.textContent,
        base64Data: downloaded.base64Data,
        uploadedDriveFile: {
          id: file.id,
          webViewLink:
            file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        },
        useAi: useAiOnUpload || Boolean(downloaded.base64Data),
      });
      setShowDrivePicker(false);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to import Drive file."
      );
    } finally {
      setBusyMsg(null);
    }
  };

  const handleSaveProfileClick = async () => {
    setErrorMsg(null);
    setBusyMsg("Saving profile & syncing to Drive...");
    try {
      await onSaveProfile(localProfile);
      setProfileDirty(false);
      await syncMasterFactsToDrive(localProfile, facts);
      setStatusMsg(
        accessToken && workspace
          ? "Saved profile to your account and synced Master_Facts_&_Profile.json in Google Drive."
          : "Saved standard autofill profile."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save profile.");
    } finally {
      setBusyMsg(null);
    }
  };

  const handleSyncFactsAndMasterDoc = async (exportPdf: boolean) => {
    if (!accessToken) {
      onReconnectDrive();
      return;
    }
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (!workspace) {
        await onProvisionWorkspace();
      }
      const blocks = buildMasterCvBlocks(localProfile, facts);
      if (masterCv?.googleDocId && !exportPdf) {
        setPendingOverwriteMasterDoc({ docId: masterCv.googleDocId, blocks });
        return;
      }

      setBusyMsg(
        exportPdf
          ? "Exporting Master CV PDF from Google Docs..."
          : "Creating Master CV Google Doc..."
      );
      let docId = masterCv?.googleDocId;
      let docUrl = masterCv?.googleDocUrl;

      if (!docId && workspace?.sourcesFolderId) {
        const created = await createFormattedGoogleDoc(accessToken, {
          title: `${localProfile.fullName || "Candidate"} — Master CV`,
          parentFolderId: workspace.sourcesFolderId,
          blocks,
        });
        docId = created.documentId;
        docUrl = created.webViewLink;
      }

      const factsFileId = await syncMasterFactsToDrive(localProfile, facts);

      await onUpdateMasterCv({
        fileName: masterCv?.fileName || `${localProfile.fullName || "Master"}_CV`,
        mimeType: masterCv?.mimeType || "application/vnd.google-apps.document",
        googleDocId: docId || "",
        googleDocUrl: docUrl || "",
        driveFileId: masterCv?.driveFileId || "",
        driveFileUrl: masterCv?.driveFileUrl || "",
        factsFileId: factsFileId || "",
        rawTextPreview: masterCv?.rawTextPreview || "",
        updatedAt: new Date().toISOString(),
      });

      if (exportPdf && docId) {
        const pdf = await exportGoogleDocAsPdf(accessToken, docId);
        triggerBlobDownload(
          pdf.blob,
          `${(localProfile.fullName || "Master_CV").replace(/\s+/g, "_")}.pdf`
        );
        setStatusMsg("Downloaded Master CV PDF from your Google Drive workspace.");
      } else {
        setStatusMsg("Saved Master CV Google Doc & Master Facts JSON to your Google Drive.");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to sync Master CV with Google Drive."
      );
    } finally {
      setBusyMsg(null);
    }
  };

  const handleConfirmOverwriteMasterDoc = async () => {
    if (!accessToken || !pendingOverwriteMasterDoc) return;
    setBusyMsg("Updating Master CV Google Doc...");
    try {
      await overwriteFormattedGoogleDoc(
        accessToken,
        pendingOverwriteMasterDoc.docId,
        pendingOverwriteMasterDoc.blocks
      );
      await syncMasterFactsToDrive(localProfile, facts);
      setStatusMsg("Updated Master CV Google Doc & Master Facts JSON in your Drive.");
      setPendingOverwriteMasterDoc(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to update Master CV Google Doc."
      );
    } finally {
      setBusyMsg(null);
    }
  };

  const handleAddManualFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDetail.trim()) return;
    const item: FactItem = {
      id: `fact_manual_${Date.now()}`,
      category: newCategory,
      title: newTitle.trim(),
      detail: newDetail.trim(),
      metrics: newMetrics.trim(),
      sourceFileName: "Manual Entry",
      verified: true,
      updatedAt: new Date().toISOString(),
    };
    await onAddFacts([item]);
    await syncMasterFactsToDrive(localProfile, [item, ...facts]);
    setNewTitle("");
    setNewDetail("");
    setNewMetrics("");
    setStatusMsg("Added fact to your vault and synced to Drive.");
  };

  const visibleFacts =
    categoryFilter === "all"
      ? facts
      : facts.filter((f) => f.category === categoryFilter);

  return (
    <div className="space-y-6">
      {/* Personal Google Drive Workspace Banner */}
      <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            {workspace ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <FolderOpen className="h-4 w-4 text-slate-600" />
            )}
            <span>
              {workspace
                ? `Your Personal Google Drive Workspace: ${workspace.rootFolderName}`
                : "Personal Google Drive Workspace"}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            {workspace
              ? "Master CV files, Master_Facts_&_Profile.json, tailored CV/Cover Letter PDFs, and your Job Tracker Sheet are stored inside your own Google account."
              : "Connect your Google Drive once to auto-create folders for your Master CV, Tailored CVs, Cover Letters, and Job Tracker Sheet."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspace ? (
            <>
              <a
                href={workspace.rootFolderUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                Open Drive Folder <ExternalLink className="h-3 w-3" />
              </a>
              {sheetConfig && (
                <a
                  href={sheetConfig.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  Open Tracker Sheet <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {!hasGoogleToken && (
                <button
                  type="button"
                  onClick={onReconnectDrive}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh Drive Access
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={hasGoogleToken ? onProvisionWorkspace : onReconnectDrive}
              disabled={provisioningWorkspace}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {provisioningWorkspace
                ? "Creating Workspace..."
                : hasGoogleToken
                ? "Create My Drive Workspace"
                : "Connect Google Drive"}
            </button>
          )}
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}
      {busyMsg && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700 flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          {busyMsg}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {statusMsg}
        </div>
      )}

      {/* Top Split: Upload Master CV (Left) + Standard Autofill Profile (Right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        <section className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                1. Upload Your Master CV
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Drop a PDF, DOCX, or TXT CV—or import from Google Drive. Saved into your personal Drive workspace and synced to your Chrome Extension.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={useAiOnUpload}
                onChange={(e) => setUseAiOnUpload(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900"
              />
              Extract facts with AI
            </label>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={handleLocalFileUpload}
          />

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={Boolean(busyMsg)}
              className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Master CV (.pdf / .docx / .txt)
            </button>

            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-3.5 w-3.5" />
              {showPasteBox ? "Hide Paste" : "Paste CV Text"}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowDrivePicker((v) => !v);
                if (!showDrivePicker && hasGoogleToken && driveFiles.length === 0) {
                  handleLoadDriveFolder();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Import from Drive
            </button>
          </div>

          {showPasteBox && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  type="text"
                  value={pastedLabel}
                  onChange={(e) => setPastedLabel(e.target.value)}
                  placeholder="Label (e.g. Master CV 2026)"
                  className="w-56 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePasteSubmit(false)}
                    disabled={Boolean(busyMsg) || !pastedText.trim()}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Parse Locally (No AI)
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePasteSubmit(true)}
                    disabled={Boolean(busyMsg) || !pastedText.trim()}
                    className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    <Sparkles className="h-3 w-3" />
                    Extract with AI
                  </button>
                </div>
              </div>
              <textarea
                rows={6}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste your Master CV text here..."
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-900"
              />
            </div>
          )}

          {showDrivePicker && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={driveFolderInput}
                  onChange={(e) => setDriveFolderInput(e.target.value)}
                  placeholder="Optional Drive folder URL/ID (defaults to your workspace folder)"
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900"
                />
                <button
                  type="button"
                  onClick={handleLoadDriveFolder}
                  disabled={loadingDrive}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  {loadingDrive ? "Loading..." : hasGoogleToken ? "List Files" : "Connect Drive"}
                </button>
              </div>
              {driveFiles.length > 0 && (
                <div className="max-h-44 divide-y divide-slate-200 overflow-y-auto rounded border border-slate-200 bg-white">
                  {driveFiles.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <span className="truncate font-medium text-slate-800">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => handleImportDriveFile(f)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50 shrink-0"
                      >
                        Use as Master CV
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Active Master CV Card */}
          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">
                {masterCv?.fileName
                  ? `Active Master CV: ${masterCv.fileName}`
                  : "No Master CV uploaded yet"}
              </div>
              {masterCv?.updatedAt && (
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Updated {new Date(masterCv.updatedAt).toLocaleDateString()}
                </span>
              )}
            </div>

            {masterCv?.rawTextPreview ? (
              <p className="text-xs leading-relaxed text-slate-600 line-clamp-3">
                {masterCv.rawTextPreview}
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Upload your CV above so CareerJogger can store it in your Drive workspace and fill every job portal automatically.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {masterCv?.googleDocUrl && (
                <a
                  href={masterCv.googleDocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                >
                  Open Master CV Doc <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {masterCv?.driveFileUrl && (
                <a
                  href={masterCv.driveFileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                >
                  Open Uploaded File <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => handleSyncFactsAndMasterDoc(false)}
                disabled={Boolean(busyMsg)}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
              >
                <Save className="h-3 w-3" />
                {masterCv?.googleDocId ? "Update Master Doc in Drive" : "Save Master Doc to Drive"}
              </button>
              {masterCv?.googleDocId && (
                <button
                  type="button"
                  onClick={() => handleSyncFactsAndMasterDoc(true)}
                  disabled={Boolean(busyMsg)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                >
                  <Download className="h-3 w-3" />
                  Export Master PDF
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right Column: Standard Autofill Profile */}
        <section className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                2. Standard Autofill Profile
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Synced live to your extension for instant 1-click form filling.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSaveProfileClick}
              disabled={Boolean(busyMsg)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                profileDirty
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <Save className="h-3 w-3" />
              {profileDirty ? "Save Changes" : "Saved"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="col-span-2">
              <label className="block font-medium text-slate-600">Full Name</label>
              <input
                type="text"
                value={localProfile.fullName}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, fullName: e.target.value });
                }}
                placeholder="Jane Doe"
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">Email</label>
              <input
                type="email"
                value={localProfile.email}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, email: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">Phone</label>
              <input
                type="text"
                value={localProfile.phone}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, phone: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">Location</label>
              <input
                type="text"
                value={localProfile.location}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, location: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">Work Auth</label>
              <input
                type="text"
                value={localProfile.workAuth}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, workAuth: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">GitHub URL</label>
              <input
                type="url"
                value={localProfile.githubUrl}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, githubUrl: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">LinkedIn URL</label>
              <input
                type="url"
                value={localProfile.linkedinUrl}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, linkedinUrl: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">Portfolio</label>
              <input
                type="url"
                value={localProfile.portfolioUrl}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, portfolioUrl: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-600">X / Twitter</label>
              <input
                type="text"
                value={localProfile.xUrl}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, xUrl: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>

            <div className="col-span-2">
              <label className="block font-medium text-slate-600">Headline / Summary</label>
              <textarea
                rows={2}
                value={localProfile.headline}
                onChange={(e) => {
                  setProfileDirty(true);
                  setLocalProfile({ ...localProfile, headline: e.target.value });
                }}
                className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
              />
            </div>
          </div>
        </section>
      </div>

      {/* Verified Career Fact Vault */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Verified Career Fact Vault ({facts.length})
            </h2>
            <p className="text-xs text-slate-500">
              Stored in your account and backed up to <span className="font-mono">Master_Facts_&_Profile.json</span> in Drive.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                categoryFilter === "all"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  categoryFilter === cat
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <form
          onSubmit={handleAddManualFact}
          className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-12"
        >
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as FactCategory)}
            className="sm:col-span-3 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Fact title..."
            className="sm:col-span-3 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
          />
          <input
            type="text"
            value={newDetail}
            onChange={(e) => setNewDetail(e.target.value)}
            placeholder="Concrete detail, stack, outcome..."
            className="sm:col-span-4 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
          />
          <button
            type="submit"
            className="sm:col-span-2 inline-flex items-center justify-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Fact
          </button>
        </form>

        {visibleFacts.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            No career facts yet. Upload your Master CV above or add key facts manually.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visibleFacts.map((fact) => (
              <div
                key={fact.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      {fact.category}
                      {fact.sourceFileName ? ` · ${fact.sourceFileName}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteFact(fact.id)}
                      className="text-slate-400 hover:text-red-600"
                      title="Delete fact"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={fact.title}
                    onChange={(e) =>
                      onUpdateFact({ ...fact, title: e.target.value })
                    }
                    className="mt-1.5 w-full bg-transparent font-display text-sm font-semibold text-slate-900 focus:outline-none"
                  />
                  <textarea
                    rows={3}
                    value={fact.detail}
                    onChange={(e) =>
                      onUpdateFact({ ...fact, detail: e.target.value })
                    }
                    className="mt-1.5 w-full resize-none bg-transparent text-xs leading-relaxed text-slate-600 focus:outline-none"
                  />
                </div>
                {fact.metrics && (
                  <div className="mt-2 border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-700">
                    Metrics: {fact.metrics}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(pendingOverwriteMasterDoc)}
        title="Update your Master CV Google Doc?"
        description="This will replace the current body text of your Master CV Google Doc in Drive with your latest profile and verified facts."
        confirmLabel="Update Master CV Doc"
        busy={Boolean(busyMsg)}
        onConfirm={handleConfirmOverwriteMasterDoc}
        onCancel={() => setPendingOverwriteMasterDoc(null)}
      />
    </div>
  );
};
