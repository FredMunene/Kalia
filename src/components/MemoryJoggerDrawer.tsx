import React, { useState } from "react";
import { X, ExternalLink, PenTool, Copy, Check, Trash2 } from "lucide-react";
import { ApplicationLogEntry, TargetPipelineEntry } from "../types/career";

type SelectedRecord =
  | { kind: "pipeline"; item: TargetPipelineEntry }
  | { kind: "application"; item: ApplicationLogEntry };

interface MemoryJoggerDrawerProps {
  record: SelectedRecord | null;
  onClose: () => void;
  onUpdatePipeline: (updated: TargetPipelineEntry) => void;
  onUpdateApplication: (updated: ApplicationLogEntry) => void;
  onDeletePipeline: (id: string) => void;
  onDeleteApplication: (id: string) => void;
  onDraftForRole: (record: SelectedRecord) => void;
}

const LOG_STATUSES = [
  "Not Applied",
  "Submitted",
  "Redirected",
  "Missed Deadline",
  "Interviewing",
  "Offer",
  "Rejected",
];

const OUTREACH_STATUSES = [
  "Not Contacted",
  "In Conversation",
  "Submitted",
  "Interviewing",
  "Closed",
];

export const MemoryJoggerDrawer: React.FC<MemoryJoggerDrawerProps> = ({
  record,
  onClose,
  onUpdatePipeline,
  onUpdateApplication,
  onDeletePipeline,
  onDeleteApplication,
  onDraftForRole,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!record) return null;

  const isPipeline = record.kind === "pipeline";
  const title = isPipeline
    ? record.item.role || record.item.company
    : record.item.role || record.item.company || "Untitled Application";
  const company = record.item.company || "Unspecified Company";

  const copyText = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1300);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-slate-950/25"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl">
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{isPipeline ? "Target Pipeline" : "Applications Log"}</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-slate-700">{company}</span>
              {isPipeline && record.item.matchScore > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    Match {record.item.matchScore}%
                  </span>
                </>
              )}
            </div>
            <h2 className="mt-1 font-display text-lg font-semibold text-slate-900">
              {title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Quick Action Strip */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onDraftForRole(record)}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <PenTool className="h-3.5 w-3.5" />
              Draft Answers for This Role
            </button>

            {(isPipeline ? record.item.applicationLink : record.item.siteLink) && (
              <a
                href={isPipeline ? record.item.applicationLink : record.item.siteLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Open Application Form
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          {/* Structured Fields */}
          {isPipeline ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Outreach Status
                </label>
                <select
                  value={record.item.outreachStatus}
                  onChange={(e) =>
                    onUpdatePipeline({ ...record.item, outreachStatus: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                >
                  {OUTREACH_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {!OUTREACH_STATUSES.includes(record.item.outreachStatus) &&
                    record.item.outreachStatus && (
                      <option value={record.item.outreachStatus}>
                        {record.item.outreachStatus}
                      </option>
                    )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  CV Version Used
                </label>
                <input
                  type="text"
                  value={record.item.cvVersion}
                  onChange={(e) =>
                    onUpdatePipeline({ ...record.item, cvVersion: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
                  placeholder="e.g. CV_Web3_DevRel_v1"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Next Action Date
                </label>
                <input
                  type="text"
                  value={record.item.nextActionDate}
                  onChange={(e) =>
                    onUpdatePipeline({ ...record.item, nextActionDate: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900 tabular-nums"
                  placeholder="YYYY-MM-DD"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Salary / Compensation
                </label>
                <input
                  type="text"
                  value={record.item.salary}
                  onChange={(e) =>
                    onUpdatePipeline({ ...record.item, salary: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600">
                  Target Contact / Recruiter
                </label>
                <input
                  type="text"
                  value={record.item.targetContact}
                  onChange={(e) =>
                    onUpdatePipeline({ ...record.item, targetContact: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600">
                  Next Action
                </label>
                <input
                  type="text"
                  value={record.item.nextAction}
                  onChange={(e) =>
                    onUpdatePipeline({ ...record.item, nextAction: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Status
                </label>
                <select
                  value={record.item.status}
                  onChange={(e) =>
                    onUpdateApplication({ ...record.item, status: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                >
                  <option value="">Unspecified</option>
                  {LOG_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {!LOG_STATUSES.includes(record.item.status) && record.item.status && (
                    <option value={record.item.status}>{record.item.status}</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Location
                </label>
                <input
                  type="text"
                  value={record.item.location}
                  onChange={(e) =>
                    onUpdateApplication({ ...record.item, location: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Application Deadline
                </label>
                <input
                  type="text"
                  value={record.item.deadline}
                  onChange={(e) =>
                    onUpdateApplication({ ...record.item, deadline: e.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Submission Date
                </label>
                <input
                  type="text"
                  value={record.item.submissionDate}
                  onChange={(e) =>
                    onUpdateApplication({
                      ...record.item,
                      submissionDate: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600">
                  Tailored CV Version Reminder
                </label>
                <input
                  type="text"
                  value={record.item.cvVersion || ""}
                  onChange={(e) =>
                    onUpdateApplication({ ...record.item, cvVersion: e.target.value })
                  }
                  placeholder="e.g. CV_Go_Payments_v2 or CV_Web3_DevRel_v1"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600">
                  Interview Prep / Reference Link
                </label>
                <input
                  type="text"
                  value={record.item.interviewPrep}
                  onChange={(e) =>
                    onUpdateApplication({
                      ...record.item,
                      interviewPrep: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                />
              </div>
            </div>
          )}

          {/* Memory Jogger Private Notes */}
          <div className="border-t border-slate-200 pt-5">
            <label className="block text-xs font-semibold text-slate-800">
              Memory Jogger Notes
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              Syncs into your exported Chrome Extension so these reminders appear automatically when you visit this company’s portal.
            </p>
            <textarea
              rows={4}
              value={record.item.notes}
              onChange={(e) =>
                isPipeline
                  ? onUpdatePipeline({ ...record.item, notes: e.target.value })
                  : onUpdateApplication({ ...record.item, notes: e.target.value })
              }
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed text-slate-900 focus:border-slate-900 focus:outline-none"
              placeholder="How you found this role, key projects to mention, recruiter contact, or referral notes..."
            />
          </div>

          {/* Saved Q&As */}
          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-xs font-semibold text-slate-800">
              Saved Application Q&As ({record.item.savedQAs?.length || 0})
            </h3>
            {!record.item.savedQAs || record.item.savedQAs.length === 0 ? (
              <p className="mt-1.5 text-xs text-slate-500">
                No saved answers yet. Use “Draft Answers for This Role” to generate fact-grounded responses and save them here.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {record.item.savedQAs.map((qa) => (
                  <div
                    key={qa.id}
                    className="rounded-md border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-900">
                        {qa.question}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(qa.id, qa.answer)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 shrink-0"
                      >
                        {copiedId === qa.id ? (
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
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-700">
                      {qa.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3">
          <button
            type="button"
            onClick={() => {
              if (isPipeline) {
                onDeletePipeline(record.item.id);
              } else {
                onDeleteApplication(record.item.id);
              }
              onClose();
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove Entry
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
