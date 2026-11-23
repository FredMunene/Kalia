import React, { useMemo, useRef, useState } from "react";
import {
  Search,
  ExternalLink,
  Upload,
  Download,
  PenTool,
  FileText,
  Sparkles,
  CheckCircle2,
  FolderPlus,
  Paperclip,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Plus,
  BookmarkCheck,
  Globe,
  AlertCircle,
} from "lucide-react";
import {
  ApplicationLogEntry,
  DriveWorkspaceConfig,
  FactItem,
  GeneratedDocumentEntry,
  ProfileDefaults,
  SavedQA,
  TailoredCoverLetterDraft,
  TailoredCvDraft,
  TokenUsageSummary,
} from "../types/career";
import { serializeApplicationsCsv } from "../utils/csvParser";
import {
  createFormattedGoogleDoc,
  DocBlock,
  exportGoogleDocAsPdf,
  overwriteFormattedGoogleDoc,
} from "../services/googleWorkspace";
import { postJson } from "../utils/safeFetch";
import { ConfirmDialog } from "./ConfirmDialog";

interface MyApplicationsViewProps {
  applications: ApplicationLogEntry[];
  facts: FactItem[];
  profile: ProfileDefaults;
  generatedDocs: GeneratedDocumentEntry[];
  workspace: DriveWorkspaceConfig | null;
  accessToken: string | null;
  hasGoogleToken: boolean;
  provisioningWorkspace: boolean;
  initialStudioRoleId?: string | null;
  initialSubTab?: "tracker" | "studio";
  onReconnectDrive: () => void;
  onProvisionWorkspace: () => Promise<void>;
  onSelectEntry: (entry: ApplicationLogEntry) => void;
  onUpdateApplication: (entry: ApplicationLogEntry) => Promise<void>;
  onImportCsvFile: (csvText: string) => Promise<void>;
  onSaveGeneratedDoc: (doc: GeneratedDocumentEntry) => Promise<void>;
  onDeleteGeneratedDoc: (id: string) => Promise<void>;
  onSaveQAsToRole: (roleId: string, qas: SavedQA[]) => Promise<void>;
  onRecordTokens: (usage?: TokenUsageSummary) => Promise<void>;
  onOpenNewModal: () => void;
}

interface QuestionDraftItem {
  id: string;
  question: string;
  charLimit: string;
  answer: string;
  citedFactIds: string[];
  missingFactGap?: string;
}

function getStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "submitted" || s === "offer") return "text-emerald-700 font-medium";
  if (s === "missed deadline" || s === "rejected") return "text-red-600 font-medium";
  if (s === "redirected" || s === "interviewing" || s === "in conversation") {
    return "text-blue-700 font-medium";
  }
  if (s === "not applied") return "text-amber-700 font-medium";
  return "text-slate-500";
}

function sanitizeFileSlug(text: string): string {
  return (
    text
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "Document"
  );
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export const MyApplicationsView: React.FC<MyApplicationsViewProps> = ({
  applications,
  facts,
  profile,
  generatedDocs,
  workspace,
  accessToken,
  hasGoogleToken,
  provisioningWorkspace,
  initialStudioRoleId,
  initialSubTab = "tracker",
  onReconnectDrive,
  onProvisionWorkspace,
  onSelectEntry,
  onUpdateApplication,
  onImportCsvFile,
  onSaveGeneratedDoc,
  onDeleteGeneratedDoc,
  onSaveQAsToRole,
  onRecordTokens,
  onOpenNewModal,
}) => {
  const [subTab, setSubTab] = useState<"tracker" | "studio">(initialSubTab);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Studio Role & Context
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    initialStudioRoleId || applications[0]?.id || ""
  );
  React.useEffect(() => {
    if (initialStudioRoleId) {
      setSelectedRoleId(initialStudioRoleId);
      setSubTab("studio");
    }
  }, [initialStudioRoleId]);

  const selectedRole =
    applications.find((a) => a.id === selectedRoleId) || null;

  const [customCompany, setCustomCompany] = useState(selectedRole?.company || "");
  const [customRole, setCustomRole] = useState(selectedRole?.role || "");
  const [jobUrl, setJobUrl] = useState(selectedRole?.siteLink || "");
  const [jobDescription, setJobDescription] = useState("");
  const [activeDocTab, setActiveDocTab] = useState<"cv" | "coverLetter" | "qa">("cv");

  const defaultContactLine = [
    profile.email,
    profile.phone,
    profile.location,
    profile.linkedinUrl,
    profile.githubUrl,
    profile.portfolioUrl,
  ]
    .filter(Boolean)
    .join(" · ");

  const [cvDraft, setCvDraft] = useState<TailoredCvDraft>(() => ({
    title: `${profile.fullName || "Candidate"} — ${selectedRole?.company || "Target"} CV`,
    headerLine: profile.fullName || "Candidate Name",
    contactLine: defaultContactLine || "email@example.com · Location · GitHub · LinkedIn",
    summary:
      profile.headline ||
      "Engineer focused on shipping production systems and clear technical architecture.",
    sections:
      facts.length > 0
        ? [
            {
              heading: "Relevant Experience & Projects",
              bullets: facts
                .slice(0, 6)
                .map((f) => `${f.title}: ${f.detail}${f.metrics ? ` (${f.metrics})` : ""}`),
            },
          ]
        : [
            {
              heading: "Experience & Projects",
              bullets: [
                "Upload your Master CV first or click Tailor CV & Cover Letter with AI.",
              ],
            },
          ],
  }));

  const [coverLetterDraft, setCoverLetterDraft] = useState<TailoredCoverLetterDraft>(() => ({
    title: `${profile.fullName || "Candidate"} — ${selectedRole?.company || "Target"} Cover Letter`,
    recipientLine: `Hiring Team · ${selectedRole?.company || "Company"}`,
    salutation: "Dear Hiring Team,",
    paragraphs: [
      `I am applying for the ${selectedRole?.role || "open"} position at ${
        selectedRole?.company || "your team"
      }. Based on my verified track record, I bring hands-on experience shipping reliable systems.`,
      facts.length > 0
        ? `Highlights from my recent work include ${facts
            .slice(0, 2)
            .map((f) => `${f.title} (${f.detail})`)
            .join("; ")}.`
        : "I look forward to bringing strong execution and measurable ownership to your engineering roadmap.",
      "Thank you for your time and consideration.",
    ],
    signOff: `Sincerely,\n${profile.fullName || "Candidate"}`,
  }));

  const [questions, setQuestions] = useState<QuestionDraftItem[]>([
    {
      id: "q-1",
      question: "Why are you interested in this role and our team?",
      charLimit: "",
      answer: "",
      citedFactIds: [],
    },
    {
      id: "q-2",
      question:
        "Describe a technical project or architecture you built that relates to this role.",
      charLimit: "",
      answer: "",
      citedFactIds: [],
    },
  ]);

  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [draftingQAs, setDraftingQAs] = useState(false);
  const [inspectingUrl, setInspectingUrl] = useState(false);
  const [busyDocAction, setBusyDocAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [missingGap, setMissingGap] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedQANotice, setSavedQANotice] = useState(false);

  const [pendingOverwriteDoc, setPendingOverwriteDoc] = useState<{
    existing: GeneratedDocumentEntry;
    blocks: DocBlock[];
  } | null>(null);

  const counts = useMemo(() => {
    let submitted = 0;
    let notApplied = 0;
    let interviewing = 0;
    let missed = 0;
    for (const a of applications) {
      const s = a.status.toLowerCase();
      if (s === "submitted" || s === "offer") submitted++;
      else if (s === "not applied") notApplied++;
      else if (s === "interviewing" || s === "in conversation" || s === "redirected") {
        interviewing++;
      } else if (s === "missed deadline") missed++;
    }
    return {
      total: applications.length,
      submitted,
      notApplied,
      interviewing,
      missed,
    };
  }, [applications]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return applications.filter((a) => {
      if (statusFilter !== "all") {
        if (a.status.toLowerCase() !== statusFilter) return false;
      }
      if (!q) return true;
      return (
        a.role.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q) ||
        a.notes.toLowerCase().includes(q) ||
        a.siteLink.toLowerCase().includes(q)
      );
    });
  }, [applications, search, statusFilter]);

  const effectiveCompany =
    selectedRole?.company || customCompany.trim() || "Target Company";
  const effectiveRole = selectedRole?.role || customRole.trim() || "Target Role";

  const existingCvRecord = generatedDocs.find(
    (d) =>
      d.docType === "cv" &&
      ((selectedRoleId && d.roleId === selectedRoleId) ||
        d.company.toLowerCase() === effectiveCompany.toLowerCase())
  );
  const existingCoverRecord = generatedDocs.find(
    (d) =>
      d.docType === "coverLetter" &&
      ((selectedRoleId && d.roleId === selectedRoleId) ||
        d.company.toLowerCase() === effectiveCompany.toLowerCase())
  );

  const handleExportCsv = () => {
    const csv = serializeApplicationsCsv(applications);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    triggerBlobDownload(blob, "CareerJogger_Applications_Log.csv");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await onImportCsvFile(text);
    e.target.value = "";
  };

  const applyLocalTemplateForRole = (
    companyName: string,
    roleName: string,
    roleNotes = ""
  ) => {
    const grouped = new Map<string, string[]>();
    for (const f of facts) {
      const list = grouped.get(f.category) || [];
      list.push(`${f.title}: ${f.detail}${f.metrics ? ` (${f.metrics})` : ""}`);
      grouped.set(f.category, list);
    }
    const sections =
      grouped.size > 0
        ? Array.from(grouped.entries()).map(([heading, bullets]) => ({
            heading,
            bullets,
          }))
        : [
            {
              heading: "Experience & Projects",
              bullets: [
                "Upload your Master CV in Master CV tab so tailored bullets appear here.",
              ],
            },
          ];

    setCvDraft({
      title: `${profile.fullName || "Candidate"} — ${companyName} ${roleName} CV`,
      headerLine: profile.fullName || "Candidate Name",
      contactLine: defaultContactLine || "email@example.com · Location · GitHub",
      summary:
        profile.headline ||
        `Candidate applying for ${roleName} at ${companyName}.`,
      sections,
    });

    const topFacts = facts
      .slice(0, 3)
      .map((f) => `${f.title} (${f.detail})`)
      .join("; ");

    setCoverLetterDraft({
      title: `${profile.fullName || "Candidate"} — ${companyName} Cover Letter`,
      recipientLine: `Hiring Team · ${companyName}`,
      salutation: `Dear ${companyName} Hiring Team,`,
      paragraphs: [
        `I am writing to apply for the ${roleName} role at ${companyName}.${
          roleNotes ? ` ${roleNotes}` : ""
        }`,
        topFacts
          ? `My verified background includes ${topFacts}.`
          : "I bring hands-on engineering experience shipping reliable production software.",
        `Thank you for considering my application for ${roleName} at ${companyName}.`,
      ],
      signOff: `Sincerely,\n${profile.fullName || "Candidate"}`,
    });
  };

  const handleRoleSelect = (id: string) => {
    setSelectedRoleId(id);
    const found = applications.find((a) => a.id === id);
    if (found) {
      setCustomCompany(found.company);
      setCustomRole(found.role);
      setJobUrl(found.siteLink || "");
      applyLocalTemplateForRole(
        found.company || "Target Company",
        found.role || "Target Role",
        found.notes || ""
      );
      if (found.savedQAs && found.savedQAs.length > 0) {
        setQuestions(
          found.savedQAs.map((qa) => ({
            id: qa.id,
            question: qa.question,
            charLimit: "",
            answer: qa.answer,
            citedFactIds: qa.citedFactIds || [],
          }))
        );
      }
    }
  };

  const handleOpenRoleInStudio = (entry: ApplicationLogEntry) => {
    handleRoleSelect(entry.id);
    setSubTab("studio");
  };

  const handleInspectUrl = async () => {
    if (!jobUrl.trim()) return;
    setInspectingUrl(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const data = await postJson<{
        ok?: boolean;
        reason?: string;
        role?: string;
        company?: string;
        location?: string;
        summary?: string;
        detectedQuestions?: string[];
        usage?: TokenUsageSummary;
      }>("/api/ai/parse-job-url", { url: jobUrl.trim() });

      if (data.usage) await onRecordTokens(data.usage);

      if (!data.ok) {
        setStatusMsg(
          data.reason ||
            "Portal blocked fetching. Paste the job description below or open the tab with the Chrome Extension."
        );
      } else {
        if (data.company && !selectedRole) setCustomCompany(data.company);
        if (data.role && !selectedRole) setCustomRole(data.role);
        setJobDescription(
          [
            data.role ? `Role: ${data.role}` : "",
            data.company ? `Company: ${data.company}` : "",
            data.location ? `Location: ${data.location}` : "",
            data.summary ? `Summary: ${data.summary}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
        if (Array.isArray(data.detectedQuestions) && data.detectedQuestions.length > 0) {
          setQuestions(
            data.detectedQuestions.map((qText, idx) => ({
              id: `q-url-${idx}`,
              question: qText,
              charLimit: "",
              answer: "",
              citedFactIds: [],
            }))
          );
        }
        setStatusMsg("Extracted role summary & questions from the job posting URL.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to inspect job URL.");
    } finally {
      setInspectingUrl(false);
    }
  };

  const handleGenerateTailoredDocs = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setMissingGap("");
    setGeneratingDocs(true);
    try {
      const data = await postJson<{
        cvDoc?: TailoredCvDraft;
        coverLetterDoc?: TailoredCoverLetterDraft;
        missingFactGap?: string;
        usage?: TokenUsageSummary;
      }>("/api/ai/generate-documents", {
        application: selectedRole || {
          company: effectiveCompany,
          role: effectiveRole,
          siteLink: jobUrl,
        },
        jobDescription,
        facts,
        profile,
      });

      if (data.usage) await onRecordTokens(data.usage);

      if (data.cvDoc) {
        setCvDraft({
          title:
            data.cvDoc.title ||
            `${profile.fullName || "Candidate"} — ${effectiveCompany} CV`,
          headerLine: data.cvDoc.headerLine || profile.fullName || "Candidate",
          contactLine: data.cvDoc.contactLine || defaultContactLine,
          summary: data.cvDoc.summary || "",
          sections: Array.isArray(data.cvDoc.sections) ? data.cvDoc.sections : [],
        });
      }
      if (data.coverLetterDoc) {
        setCoverLetterDraft({
          title:
            data.coverLetterDoc.title ||
            `${profile.fullName || "Candidate"} — ${effectiveCompany} Cover Letter`,
          recipientLine:
            data.coverLetterDoc.recipientLine || `Hiring Team · ${effectiveCompany}`,
          salutation: data.coverLetterDoc.salutation || "Dear Hiring Team,",
          paragraphs: Array.isArray(data.coverLetterDoc.paragraphs)
            ? data.coverLetterDoc.paragraphs
            : [],
          signOff:
            data.coverLetterDoc.signOff ||
            `Sincerely,\n${profile.fullName || "Candidate"}`,
        });
      }
      if (data.missingFactGap) setMissingGap(data.missingFactGap);

      if (selectedRole && data.usage?.totalTokenCount) {
        await onUpdateApplication({
          ...selectedRole,
          tokensUsed: (selectedRole.tokensUsed || 0) + data.usage.totalTokenCount,
        });
      }

      setStatusMsg(
        `Drafted tailored CV & Cover Letter for ${effectiveCompany}. Review and save to Google Drive.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to draft documents.");
    } finally {
      setGeneratingDocs(false);
    }
  };

  const handleDraftAllQAs = async () => {
    const validQs = questions.filter((q) => q.question.trim().length > 0);
    if (validQs.length === 0) return;

    setDraftingQAs(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setSavedQANotice(false);
    try {
      const data = await postJson<{
        drafts?: Array<{
          questionId: string;
          answer: string;
          citedFactIds: string[];
          missingFactGap?: string;
        }>;
        usage?: TokenUsageSummary;
      }>("/api/ai/draft-answers", {
        application: selectedRole || {
          company: effectiveCompany,
          role: effectiveRole,
          siteLink: jobUrl,
        },
        jobDescription,
        questions: validQs.map((q) => ({
          id: q.id,
          question: q.question,
          charLimit: q.charLimit ? Number(q.charLimit) : undefined,
        })),
        facts,
        profile,
      });

      if (data.usage) await onRecordTokens(data.usage);

      const draftMap = new Map<
        string,
        { answer: string; citedFactIds: string[]; missingFactGap?: string }
      >();
      for (const d of data.drafts || []) {
        draftMap.set(d.questionId, d);
      }

      setQuestions((prev) =>
        prev.map((q) => {
          const hit = draftMap.get(q.id);
          if (!hit) return q;
          return {
            ...q,
            answer: hit.answer || "",
            citedFactIds: hit.citedFactIds || [],
            missingFactGap: hit.missingFactGap || "",
          };
        })
      );
      setStatusMsg(`Drafted ${validQs.length} answer(s) grounded in your Master CV & Fact Vault.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to draft answers.");
    } finally {
      setDraftingQAs(false);
    }
  };

  const handleSaveQAs = async () => {
    if (!selectedRoleId) return;
    const answered: SavedQA[] = questions
      .filter((q) => q.question.trim() && q.answer.trim())
      .map((q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        citedFactIds: q.citedFactIds,
        updatedAt: new Date().toISOString(),
      }));
    if (answered.length === 0) return;
    await onSaveQAsToRole(selectedRoleId, answered);
    setSavedQANotice(true);
    setTimeout(() => setSavedQANotice(false), 2000);
  };

  const buildCvBlocks = (): DocBlock[] => {
    const blocks: DocBlock[] = [
      { text: cvDraft.headerLine || profile.fullName || "Candidate", style: "TITLE" },
      { text: cvDraft.contactLine, style: "SUBTITLE" },
    ];
    if (cvDraft.summary.trim()) {
      blocks.push({ text: "SUMMARY", style: "HEADING_2" });
      blocks.push({ text: cvDraft.summary, style: "BODY" });
    }
    for (const sec of cvDraft.sections) {
      if (!sec.heading.trim()) continue;
      blocks.push({ text: sec.heading.toUpperCase(), style: "HEADING_2" });
      for (const b of sec.bullets) {
        if (b.trim()) blocks.push({ text: b.trim(), style: "BULLET" });
      }
    }
    return blocks;
  };

  const buildCoverLetterBlocks = (): DocBlock[] => [
    { text: profile.fullName || cvDraft.headerLine || "Candidate", style: "TITLE" },
    { text: cvDraft.contactLine, style: "SUBTITLE" },
    { text: coverLetterDraft.recipientLine, style: "BODY" },
    { text: coverLetterDraft.salutation, style: "BODY" },
    ...coverLetterDraft.paragraphs.map((p) => ({ text: p, style: "BODY" as const })),
    { text: coverLetterDraft.signOff, style: "BODY" },
  ];

  const saveAndOrExportDoc = async (
    docType: "cv" | "coverLetter",
    alsoExportPdf: boolean
  ) => {
    if (!accessToken) {
      onReconnectDrive();
      return;
    }

    setErrorMsg(null);
    setStatusMsg(null);
    setBusyDocAction(`${docType}-${alsoExportPdf ? "pdf" : "doc"}`);

    try {
      const blocks = docType === "cv" ? buildCvBlocks() : buildCoverLetterBlocks();
      const title =
        docType === "cv"
          ? cvDraft.title.trim() || `${effectiveCompany} CV`
          : coverLetterDraft.title.trim() || `${effectiveCompany} Cover Letter`;

      const existing = docType === "cv" ? existingCvRecord : existingCoverRecord;
      let docId = existing?.googleDocId;
      let docUrl = existing?.googleDocUrl;

      if (!docId) {
        const folderId =
          docType === "cv" ? workspace?.cvsFolderId : workspace?.coverLettersFolderId;
        const created = await createFormattedGoogleDoc(accessToken, {
          title,
          parentFolderId: folderId,
          blocks,
        });
        docId = created.documentId;
        docUrl = created.webViewLink;
      } else if (!alsoExportPdf) {
        setPendingOverwriteDoc({ existing: existing!, blocks });
        setBusyDocAction(null);
        return;
      }

      const fileName = `${sanitizeFileSlug(title)}.pdf`;
      let pdfBase64 = existing?.pdfBase64;

      if (alsoExportPdf && docId) {
        const exported = await exportGoogleDocAsPdf(accessToken, docId);
        pdfBase64 = exported.base64;
        triggerBlobDownload(exported.blob, fileName);
      }

      const savedRecord: GeneratedDocumentEntry = {
        id: existing?.id || `doc_${docType}_${Date.now()}`,
        docType,
        roleId: selectedRoleId || undefined,
        company: effectiveCompany,
        role: effectiveRole,
        title,
        googleDocId: docId,
        googleDocUrl: docUrl,
        pdfFileName: fileName,
        pdfBase64,
        updatedAt: new Date().toISOString(),
      };
      await onSaveGeneratedDoc(savedRecord);

      // Link Google Doc onto the application record so the extension can attach it directly
      if (selectedRole && docId && docUrl) {
        await onUpdateApplication({
          ...selectedRole,
          ...(docType === "cv"
            ? { cvDocId: docId, cvDocUrl: docUrl, cvVersion: title }
            : { coverDocId: docId, coverDocUrl: docUrl }),
        });
      }

      setStatusMsg(
        alsoExportPdf
          ? `Exported ${fileName} from your Drive folder and synced it for Chrome Extension attachment.`
          : `Saved "${title}" to your Google Drive workspace.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Google Docs operation failed.");
    } finally {
      setBusyDocAction(null);
    }
  };

  const handleConfirmOverwriteDoc = async () => {
    if (!accessToken || !pendingOverwriteDoc) return;
    setBusyDocAction("overwrite");
    try {
      await overwriteFormattedGoogleDoc(
        accessToken,
        pendingOverwriteDoc.existing.googleDocId!,
        pendingOverwriteDoc.blocks
      );
      await onSaveGeneratedDoc({
        ...pendingOverwriteDoc.existing,
        updatedAt: new Date().toISOString(),
      });
      setStatusMsg(`Updated "${pendingOverwriteDoc.existing.title}" in Google Docs.`);
      setPendingOverwriteDoc(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to overwrite Google Doc.");
    } finally {
      setBusyDocAction(null);
    }
  };

  const currentDocRecord =
    activeDocTab === "cv" ? existingCvRecord : existingCoverRecord;

  return (
    <div className="space-y-6">
      {/* Metrics Strip + Sub-View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-xs text-slate-500">Total Tracked</div>
            <div className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
              {counts.total}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Submitted</div>
            <div className="font-mono text-xl font-semibold text-emerald-700 tabular-nums">
              {counts.submitted}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Active / Interviewing</div>
            <div className="font-mono text-xl font-semibold text-blue-700 tabular-nums">
              {counts.interviewing}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Not Applied</div>
            <div className="font-mono text-xl font-semibold text-amber-700 tabular-nums">
              {counts.notApplied}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSubTab("tracker")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === "tracker"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Applications Tracker ({applications.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab("studio")}
            className={`rounded px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              subTab === "studio"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Tailored CV, Cover Letter & Q&As
          </button>
        </div>
      </div>

      {subTab === "tracker" ? (
        <div className="space-y-5">
          {/* Filter & CSV Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search role, company, URL, notes..."
                  className="w-64 rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
                {[
                  { id: "all", label: "All" },
                  { id: "not applied", label: "Not Applied" },
                  { id: "submitted", label: "Submitted" },
                  { id: "interviewing", label: "Interviewing" },
                  { id: "missed deadline", label: "Missed" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                      statusFilter === tab.id
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5 text-slate-500" />
                Import CSV
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={applications.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-slate-500" />
                Export CSV
              </button>
            </div>
          </div>

          {applications.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-10 text-center space-y-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Your Application Tracker is Empty
              </h3>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-slate-600">
                Add a target role manually, import an existing CSV tracker, or use the Chrome Extension on any job posting to auto-fill and log applications here automatically.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onOpenNewModal}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add First Role
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab("studio")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Open Tailored Doc Studio
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <th className="px-4 py-2.5">Role & Company</th>
                    <th className="px-4 py-2.5">Location</th>
                    <th className="px-4 py-2.5">Dates</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Drive Docs & Notes</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                        No applications match your filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((app) => (
                      <tr
                        key={app.id}
                        onClick={() => onSelectEntry(app)}
                        className="cursor-pointer transition-colors hover:bg-slate-50/90"
                      >
                        <td className="px-4 py-2.5 max-w-xs">
                          <div className="font-medium text-slate-900 truncate">
                            {app.role || "Untitled Role"}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {app.company || "Company not specified"}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 max-w-[140px] truncate">
                          {app.location || "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                          {app.submissionDate && <div>Sent: {app.submissionDate}</div>}
                          {app.deadline && <div>Due: {app.deadline}</div>}
                          {!app.submissionDate && !app.deadline && "—"}
                        </td>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={app.status}
                            onChange={(e) =>
                              onUpdateApplication({
                                ...app,
                                status: e.target.value,
                                submissionDate:
                                  e.target.value === "Submitted" && !app.submissionDate
                                    ? new Date().toISOString().slice(0, 10)
                                    : app.submissionDate,
                              })
                            }
                            className={`bg-transparent text-xs focus:outline-none ${getStatusColor(
                              app.status
                            )}`}
                          >
                            <option value="">Unspecified</option>
                            <option value="Not Applied">Not Applied</option>
                            <option value="Submitted">Submitted</option>
                            <option value="Redirected">Redirected</option>
                            <option value="Missed Deadline">Missed Deadline</option>
                            <option value="Interviewing">Interviewing</option>
                            <option value="Offer">Offer</option>
                            <option value="Rejected">Rejected</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 max-w-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            {app.cvDocUrl && (
                              <a
                                href={app.cvDocUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-700 underline"
                              >
                                CV Doc <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                            {app.coverDocUrl && (
                              <a
                                href={app.coverDocUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-700 underline"
                              >
                                Cover Doc <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                            {!app.cvDocUrl && !app.coverDocUrl && (
                              <span className="truncate">{app.notes || app.source || "—"}</span>
                            )}
                          </div>
                        </td>
                        <td
                          className="px-4 py-2.5 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenRoleInStudio(app)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <PenTool className="h-3 w-3" />
                              Tailor & Draft
                            </button>
                            {app.siteLink && /^https?:\/\//i.test(app.siteLink) && (
                              <a
                                href={app.siteLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                title="Open job link"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
          {/* Left Column: Role & Job Context */}
          <div className="lg:col-span-5 space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Target Role & Job Description
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Tailor a CV, Cover Letter, and Q&A answers from your Master CV and save directly into your Drive workspace.
                </p>
              </div>

              {!workspace ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                  <div className="text-xs font-semibold text-slate-800">
                    Google Drive Workspace Not Linked Yet
                  </div>
                  <button
                    type="button"
                    onClick={hasGoogleToken ? onProvisionWorkspace : onReconnectDrive}
                    disabled={provisioningWorkspace}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    {provisioningWorkspace
                      ? "Creating Workspace..."
                      : hasGoogleToken
                      ? "Create Drive Workspace"
                      : "Connect Google Drive"}
                  </button>
                </div>
              ) : (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-medium truncate">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                    {workspace.rootFolderName} ready
                  </span>
                  <a
                    href={workspace.rootFolderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline shrink-0"
                  >
                    Open Drive <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Select Application Role
                </label>
                <select
                  value={selectedRoleId}
                  onChange={(e) => handleRoleSelect(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="">Custom / New Role</option>
                  {applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.company || "Company"} — {a.role || "Role"}
                    </option>
                  ))}
                </select>
              </div>

              {!selectedRoleId && (
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Company
                    </label>
                    <input
                      type="text"
                      value={customCompany}
                      onChange={(e) => setCustomCompany(e.target.value)}
                      placeholder="e.g. Stripe"
                      className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Role Title
                    </label>
                    <input
                      type="text"
                      value={customRole}
                      onChange={(e) => setCustomRole(e.target.value)}
                      placeholder="e.g. Solutions Engineer"
                      className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Job Posting URL
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="url"
                    value={jobUrl}
                    onChange={(e) => setJobUrl(e.target.value)}
                    placeholder="https://jobs.lever.co/..."
                    className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleInspectUrl}
                    disabled={inspectingUrl || !jobUrl.trim()}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    {inspectingUrl ? "Reading..." : "Inspect"}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Job Description / Role Priorities
                </label>
                <textarea
                  rows={5}
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the job description here so your tailored CV, Cover Letter, and Q&A answers match key requirements..."
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs leading-relaxed text-slate-900"
                />
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleGenerateTailoredDocs}
                  disabled={generatingDocs}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {generatingDocs
                    ? "Drafting Tailored CV & Cover Letter..."
                    : "Tailor CV & Cover Letter with AI"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    applyLocalTemplateForRole(
                      effectiveCompany,
                      effectiveRole,
                      selectedRole?.notes || ""
                    );
                    setStatusMsg(
                      `Assembled CV & Cover Letter drafts locally from ${facts.length} verified fact(s).`
                    );
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Assemble Locally from Master Facts (No AI)
                </button>
              </div>
            </section>

            {/* Saved Drive Docs List */}
            <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Saved Drive Docs ({generatedDocs.length})
                </h3>
                <span className="font-mono text-[11px] text-slate-500">
                  Synced to Extension
                </span>
              </div>
              {generatedDocs.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Save a Tailored CV or Cover Letter to Google Docs on the right to attach it as a PDF in 1 click via the Chrome Extension.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {generatedDocs.map((docItem) => (
                    <li
                      key={docItem.id}
                      className="py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">
                          {docItem.title}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span>
                            {docItem.docType === "cv" ? "CV" : "Cover Letter"}
                          </span>
                          <span>· {docItem.company}</span>
                          {docItem.googleDocId && (
                            <span className="inline-flex items-center gap-0.5 text-emerald-700 font-medium">
                              <Paperclip className="h-3 w-3" /> Drive PDF ready
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {docItem.googleDocUrl && (
                          <a
                            href={docItem.googleDocUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-500 hover:text-slate-900"
                            title="Open Google Doc"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteGeneratedDoc(docItem.id)}
                          className="text-slate-400 hover:text-red-600"
                          title="Delete doc record"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Right Column: CV Editor / Cover Letter Editor / Form Q&A Drafter */}
          <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveDocTab("cv")}
                  className={`rounded px-3 py-1.5 text-xs font-semibold ${
                    activeDocTab === "cv"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Tailored CV
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDocTab("coverLetter")}
                  className={`rounded px-3 py-1.5 text-xs font-semibold ${
                    activeDocTab === "coverLetter"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Cover Letter
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDocTab("qa")}
                  className={`rounded px-3 py-1.5 text-xs font-semibold ${
                    activeDocTab === "qa"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Custom Q&As ({questions.length})
                </button>
              </div>

              {activeDocTab !== "qa" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {!hasGoogleToken ? (
                    <button
                      type="button"
                      onClick={onReconnectDrive}
                      className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Connect Drive to Save Docs
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => saveAndOrExportDoc(activeDocTab, false)}
                        disabled={busyDocAction !== null}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            busyDocAction?.endsWith("doc") ? "animate-spin" : ""
                          }`}
                        />
                        {currentDocRecord?.googleDocId
                          ? "Update Google Doc"
                          : "Save to Google Docs"}
                      </button>
                      <button
                        type="button"
                        onClick={() => saveAndOrExportDoc(activeDocTab, true)}
                        disabled={busyDocAction !== null}
                        className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {busyDocAction?.endsWith("pdf")
                          ? "Exporting PDF..."
                          : "Export PDF"}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {selectedRoleId && (
                    <button
                      type="button"
                      onClick={handleSaveQAs}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <BookmarkCheck className="h-3.5 w-3.5" />
                      {savedQANotice ? "Saved Q&As" : "Save Q&As to Role"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDraftAllQAs}
                    disabled={draftingQAs}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:bg-slate-500"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {draftingQAs ? "Drafting..." : "Draft Grounded Answers"}
                  </button>
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {errorMsg}
              </div>
            )}
            {statusMsg && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center justify-between gap-2">
                <span>{statusMsg}</span>
                {activeDocTab !== "qa" && currentDocRecord?.googleDocUrl && (
                  <a
                    href={currentDocRecord.googleDocUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold underline shrink-0"
                  >
                    Open Google Doc <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
            {missingGap && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Fact Vault gap noted: {missingGap}
              </div>
            )}

            {activeDocTab === "cv" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500">
                    Google Doc & PDF Name
                  </label>
                  <input
                    type="text"
                    value={cvDraft.title}
                    onChange={(e) => setCvDraft({ ...cvDraft, title: e.target.value })}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900"
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <input
                    type="text"
                    value={cvDraft.headerLine}
                    onChange={(e) =>
                      setCvDraft({ ...cvDraft, headerLine: e.target.value })
                    }
                    className="w-full bg-transparent font-display text-lg font-bold text-slate-900 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={cvDraft.contactLine}
                    onChange={(e) =>
                      setCvDraft({ ...cvDraft, contactLine: e.target.value })
                    }
                    className="w-full bg-transparent font-mono text-xs text-slate-600 focus:outline-none"
                  />
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Summary
                    </div>
                    <textarea
                      rows={3}
                      value={cvDraft.summary}
                      onChange={(e) =>
                        setCvDraft({ ...cvDraft, summary: e.target.value })
                      }
                      className="w-full rounded border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-800"
                    />
                  </div>
                  {cvDraft.sections.map((sec, sIdx) => (
                    <div key={sIdx} className="space-y-1.5 pt-2 border-t border-slate-200">
                      <input
                        type="text"
                        value={sec.heading}
                        onChange={(e) => {
                          const next = [...cvDraft.sections];
                          next[sIdx] = { ...sec, heading: e.target.value };
                          setCvDraft({ ...cvDraft, sections: next });
                        }}
                        className="w-full bg-transparent text-xs font-bold uppercase tracking-wider text-slate-700 focus:outline-none"
                      />
                      <textarea
                        rows={Math.max(3, sec.bullets.length + 1)}
                        value={sec.bullets.join("\n")}
                        onChange={(e) => {
                          const next = [...cvDraft.sections];
                          next[sIdx] = {
                            ...sec,
                            bullets: e.target.value.split("\n"),
                          };
                          setCvDraft({ ...cvDraft, sections: next });
                        }}
                        className="w-full rounded border border-slate-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-slate-800"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeDocTab === "coverLetter" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500">
                    Google Doc & PDF Name
                  </label>
                  <input
                    type="text"
                    value={coverLetterDraft.title}
                    onChange={(e) =>
                      setCoverLetterDraft({ ...coverLetterDraft, title: e.target.value })
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900"
                  />
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                  <input
                    type="text"
                    value={coverLetterDraft.recipientLine}
                    onChange={(e) =>
                      setCoverLetterDraft({
                        ...coverLetterDraft,
                        recipientLine: e.target.value,
                      })
                    }
                    className="w-full bg-transparent text-xs font-medium text-slate-600 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={coverLetterDraft.salutation}
                    onChange={(e) =>
                      setCoverLetterDraft({
                        ...coverLetterDraft,
                        salutation: e.target.value,
                      })
                    }
                    className="w-full bg-transparent text-sm font-medium text-slate-900 focus:outline-none"
                  />
                  <textarea
                    rows={10}
                    value={coverLetterDraft.paragraphs.join("\n\n")}
                    onChange={(e) =>
                      setCoverLetterDraft({
                        ...coverLetterDraft,
                        paragraphs: e.target.value.split(/\n{2,}/),
                      })
                    }
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800"
                  />
                  <textarea
                    rows={2}
                    value={coverLetterDraft.signOff}
                    onChange={(e) =>
                      setCoverLetterDraft({
                        ...coverLetterDraft,
                        signOff: e.target.value,
                      })
                    }
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800"
                  />
                </div>
              </div>
            )}

            {activeDocTab === "qa" && (
              <div className="space-y-5">
                {questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="space-y-2 border-b border-slate-200 pb-4 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">
                        Question {idx + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={q.charLimit}
                          onChange={(e) =>
                            setQuestions((prev) =>
                              prev.map((item) =>
                                item.id === q.id
                                  ? { ...item, charLimit: e.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Max chars"
                          className="w-24 rounded border border-slate-300 px-2 py-1 font-mono text-[11px] text-slate-800"
                        />
                        {questions.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setQuestions((prev) =>
                                prev.filter((item) => item.id !== q.id)
                              )
                            }
                            className="text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <input
                      type="text"
                      value={q.question}
                      onChange={(e) =>
                        setQuestions((prev) =>
                          prev.map((item) =>
                            item.id === q.id
                              ? { ...item, question: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Paste custom application form question..."
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-900"
                    />

                    <textarea
                      rows={4}
                      value={q.answer}
                      onChange={(e) =>
                        setQuestions((prev) =>
                          prev.map((item) =>
                            item.id === q.id
                              ? { ...item, answer: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Grounded answer will appear here..."
                      className="w-full rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs leading-relaxed text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                    />

                    {q.answer && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-mono tabular-nums">
                          {q.answer.length} chars ·{" "}
                          {q.answer.trim().split(/\s+/).length} words
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(q.answer);
                            setCopiedId(q.id);
                            setTimeout(() => setCopiedId(null), 1300);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {copiedId === q.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-600" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {q.missingFactGap && (
                      <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>Gap noted: {q.missingFactGap}</span>
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setQuestions((prev) => [
                      ...prev,
                      {
                        id: `q-${Date.now()}`,
                        question: "",
                        charLimit: "",
                        answer: "",
                        citedFactIds: [],
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Another Question
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingOverwriteDoc)}
        title="Overwrite existing Google Doc?"
        description="This will replace the current body text of your linked Google Doc with your edited draft."
        details={
          pendingOverwriteDoc
            ? [
                `Document: ${pendingOverwriteDoc.existing.title}`,
                `Company / Role: ${pendingOverwriteDoc.existing.company} — ${pendingOverwriteDoc.existing.role}`,
              ]
            : []
        }
        confirmLabel="Update Google Doc"
        busy={busyDocAction === "overwrite"}
        onConfirm={handleConfirmOverwriteDoc}
        onCancel={() => setPendingOverwriteDoc(null)}
      />
    </div>
  );
};
