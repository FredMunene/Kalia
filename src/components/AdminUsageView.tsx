import React, { useMemo, useState } from "react";
import { Search, ShieldCheck, CheckCircle2, Clock } from "lucide-react";
import { UserStatsEntry } from "../types/career";

interface AdminUsageViewProps {
  stats: UserStatsEntry[];
  loading: boolean;
}

export const AdminUsageView: React.FC<AdminUsageViewProps> = ({
  stats,
  loading,
}) => {
  const [search, setSearch] = useState("");

  const totals = useMemo(() => {
    let totalApps = 0;
    let totalTokens = 0;
    let cvCount = 0;
    for (const u of stats) {
      totalApps += u.applicationCount || 0;
      totalTokens += u.totalTokensUsed || 0;
      if (u.masterCvUploaded) cvCount++;
    }
    return {
      users: stats.length,
      cvCount,
      totalApps,
      totalTokens,
    };
  }, [stats]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stats;
    return stats.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)
    );
  }, [stats, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Platform Admin Telemetry</span>
          </div>
          <h2 className="mt-1 font-display text-lg font-semibold text-slate-900">
            Multi-User Applications & Gemini Token Usage
          </h2>
          <p className="text-xs text-slate-500">
            Tracks user adoption, submitted applications, and token consumption without exposing private CVs or Drive documents.
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by user name or email..."
            className="w-64 rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Active Accounts</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {totals.users}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Master CVs Uploaded</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {totals.cvCount}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Total Applications</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {totals.totalApps.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Total Gemini Tokens</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {totals.totalTokens.toLocaleString()}
          </div>
        </div>
      </div>

      {/* User Usage Ledger Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
              <th className="px-4 py-2.5">Applicant</th>
              <th className="px-4 py-2.5">Master CV</th>
              <th className="px-4 py-2.5">Drive Workspace</th>
              <th className="px-4 py-2.5 text-right">Applications</th>
              <th className="px-4 py-2.5 text-right">Prompt Tokens</th>
              <th className="px-4 py-2.5 text-right">Output Tokens</th>
              <th className="px-4 py-2.5 text-right">Total Tokens</th>
              <th className="px-4 py-2.5 text-right">Last Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                  Loading user telemetry...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                  No users found matching your filter.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.uid} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {row.displayName || "Applicant"}
                    </div>
                    <div className="font-mono text-xs text-slate-500">
                      {row.email}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.masterCvUploaded ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Uploaded
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <Clock className="h-3.5 w-3.5" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {row.driveWorkspaceLinked ? (
                      <span className="font-medium text-emerald-700">Linked</span>
                    ) : (
                      <span className="text-slate-400">Not linked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                    {row.applicationCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                    {row.promptTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 tabular-nums">
                    {row.outputTokens.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                    {row.totalTokensUsed.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                    {row.updatedAtIso
                      ? new Date(row.updatedAtIso).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
