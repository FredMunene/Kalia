import React, { useState } from "react";
import { X } from "lucide-react";
import { ApplicationLogEntry } from "../types/career";

interface NewApplicationModalProps {
  open: boolean;
  onClose: () => void;
  onAddApplication: (entry: ApplicationLogEntry) => void;
}

export const NewApplicationModal: React.FC<NewApplicationModalProps> = ({
  open,
  onClose,
  onAddApplication,
}) => {
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("Remote");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("Not Applied");
  const [deadline, setDeadline] = useState("");
  const [cvVersion, setCvVersion] = useState("");
  const [notes, setNotes] = useState("");

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!role.trim() && !company.trim()) return;

    onAddApplication({
      id: `app_${Date.now()}`,
      role: role.trim(),
      company: company.trim(),
      location: location.trim(),
      siteLink: url.trim(),
      deadline: deadline.trim(),
      submissionDate:
        status === "Submitted" ? new Date().toISOString().slice(0, 10) : "",
      status,
      notes: notes.trim(),
      companyProfile: "",
      source: "Manual Entry",
      otherLinks: "",
      interviewPrep: "",
      cvVersion: cvVersion.trim(),
    });

    setRole("");
    setCompany("");
    setUrl("");
    setNotes("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Add Job Application
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700">Role</label>
            <input
              type="text"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Developer Advocate"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">Company</label>
            <input
              type="text"
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Arbitrum / Offchain Labs"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
            >
              <option value="Not Applied">Not Applied</option>
              <option value="Submitted">Submitted</option>
              <option value="Interviewing">Interviewing</option>
              <option value="Redirected">Redirected</option>
              <option value="Missed Deadline">Missed Deadline</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className="block font-medium text-slate-700">
              Application / Form URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700">Deadline</label>
            <input
              type="text"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              placeholder="YYYY-MM-DD"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>

          <div>
            <label className="block font-medium text-slate-700">CV Track</label>
            <input
              type="text"
              value={cvVersion}
              onChange={(e) => setCvVersion(e.target.value)}
              placeholder="Master CV"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs text-slate-900"
            />
          </div>

          <div className="col-span-2">
            <label className="block font-medium text-slate-700">
              Memory Jogger Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Key angles, contacts, referral channel..."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Add Application
          </button>
        </div>
      </form>
    </div>
  );
};
