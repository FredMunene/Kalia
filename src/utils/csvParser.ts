import { ApplicationLogEntry, TargetPipelineEntry } from "../types/career";

/**
 * RFC-4180 compliant CSV parser that also unwraps stacked/nested inner-quoted
 * rows (such as the second Target Pipeline table inside Job_Tracker).
 */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const text = input.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r" && next === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function unwrapNestedRowIfNeeded(cells: string[]): string[] {
  if (
    cells.length > 1 &&
    cells[0] &&
    cells[0].includes(",") &&
    cells.slice(1).every((c) => c.trim() === "")
  ) {
    const nested = parseCsvRows(cells[0]);
    if (nested.length > 0 && nested[0].length >= 5) {
      return nested[0];
    }
  }
  return cells;
}

export function parseJobTrackerCsv(csvText: string): {
  applications: ApplicationLogEntry[];
  pipeline: TargetPipelineEntry[];
} {
  const rawRows = parseCsvRows(csvText);
  const applications: ApplicationLogEntry[] = [];
  const pipeline: TargetPipelineEntry[] = [];

  let mode: "applications" | "pipeline" = "applications";

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const isEmptyRow = row.every((c) => c.trim() === "");
    if (isEmptyRow) continue;

    const unwrapped = unwrapNestedRowIfNeeded(row);
    const firstCell = (unwrapped[0] || "").trim();

    if (i === 0 && firstCell.toLowerCase() === "role") {
      mode = "applications";
      continue;
    }

    if (firstCell.toLowerCase() === "verification status") {
      mode = "pipeline";
      continue;
    }

    if (mode === "applications") {
      const entry: ApplicationLogEntry = {
        id: `app-${i}-${(unwrapped[1] || unwrapped[0] || "row").slice(0, 12).replace(/\W+/g, "")}`,
        role: (unwrapped[0] || "").trim(),
        company: (unwrapped[1] || "").trim(),
        location: (unwrapped[2] || "").trim(),
        siteLink: (unwrapped[3] || "").trim(),
        deadline: (unwrapped[4] || "").trim(),
        submissionDate: (unwrapped[5] || "").trim(),
        status: (unwrapped[6] || "").trim(),
        notes: (unwrapped[7] || "").trim(),
        companyProfile: (unwrapped[8] || "").trim(),
        source: (unwrapped[9] || "").trim(),
        otherLinks: (unwrapped[10] || "").trim(),
        interviewPrep: (unwrapped[11] || "").trim(),
      };

      if (entry.role || entry.company || entry.siteLink || entry.notes) {
        applications.push(entry);
      }
    } else {
      const matchNum = Number.parseInt((unwrapped[3] || "0").trim(), 10);
      const entry: TargetPipelineEntry = {
        id: `pipe-${i}-${(unwrapped[1] || "target").slice(0, 12).replace(/\W+/g, "")}`,
        verificationStatus: (unwrapped[0] || "").trim(),
        company: (unwrapped[1] || "").trim(),
        role: (unwrapped[2] || "").trim(),
        matchScore: Number.isFinite(matchNum) ? matchNum : 0,
        location: (unwrapped[4] || "").trim(),
        salary: (unwrapped[5] || "").trim(),
        cvVersion: (unwrapped[6] || "").trim(),
        applicationMethod: (unwrapped[7] || "").trim(),
        targetContact: (unwrapped[8] || "").trim(),
        outreachStatus: (unwrapped[9] || "").trim(),
        nextActionDate: (unwrapped[10] || "").trim(),
        nextAction: (unwrapped[11] || "").trim(),
        applicationLink: (unwrapped[12] || "").trim(),
        notes: (unwrapped[13] || "").trim(),
      };

      if (entry.company || entry.role) {
        pipeline.push(entry);
      }
    }
  }

  return { applications, pipeline };
}

function escapeCsvCell(val: string | number | undefined): string {
  const s = String(val ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function serializeApplicationsCsv(apps: ApplicationLogEntry[]): string {
  const header = [
    "Role",
    "Company",
    "Location",
    "Site link",
    "Application Deadline",
    "Submission Date",
    "Status",
    "Notes",
    "Company Profile",
    "Source",
    "other links",
    "interview-prep",
  ];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const a of apps) {
    lines.push(
      [
        a.role,
        a.company,
        a.location,
        a.siteLink,
        a.deadline,
        a.submissionDate,
        a.status,
        a.notes,
        a.companyProfile,
        a.source,
        a.otherLinks,
        a.interviewPrep,
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function serializePipelineCsv(pipeline: TargetPipelineEntry[]): string {
  const header = [
    "Verification Status",
    "Company",
    "Role",
    "Match Score",
    "Location",
    "Salary",
    "CV Version Used",
    "Application Method",
    "Target Contact / Recruiter",
    "Outreach Status",
    "Next Action Date",
    "Next Action",
    "Application Link",
    "Notes",
  ];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const p of pipeline) {
    lines.push(
      [
        p.verificationStatus,
        p.company,
        p.role,
        p.matchScore,
        p.location,
        p.salary,
        p.cvVersion,
        p.applicationMethod,
        p.targetContact,
        p.outreachStatus,
        p.nextActionDate,
        p.nextAction,
        p.applicationLink,
        p.notes,
      ]
        .map(escapeCsvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}
