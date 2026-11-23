import {
  ApplicationLogEntry,
  DriveFileEntry,
  DriveWorkspaceConfig,
  SheetSyncConfig,
  TargetPipelineEntry,
} from "../types/career";
import {
  extractTextFromDocxBuffer,
  extractTextFromPdfBuffer,
} from "../utils/documentTextExtractor";

export const DEFAULT_DRIVE_FOLDER_ID = "1_qNXgWdGjZ7JthlrdmSnHr252FBL7DMA";

export function extractDriveFolderId(input: string): string {
  const trimmed = input.trim();
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) return idParamMatch[1];
  return trimmed;
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return trimmed;
}

async function fetchGoogleJson<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!res.ok) {
        throw new Error(`Google API error (${res.status}): ${text.slice(0, 120)}`);
      }
      throw new Error(`Unexpected non-JSON response from Google API (${res.status}).`);
    }
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "Google Workspace session expired (401). Click Sign Out in the header and Sign in with Google again."
      );
    }
    const apiErr = (parsed as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(apiErr || `Google API error (${res.status})`);
  }
  return (parsed ?? {}) as T;
}

export async function listDriveFolderFiles(
  accessToken: string,
  folderId: string
): Promise<DriveFileEntry[]> {
  const query = `'${folderId}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
    pageSize: "100",
    orderBy: "modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const data = await fetchGoogleJson<{ files?: DriveFileEntry[] }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );

  const rootFiles = data.files || [];
  const folders = rootFiles.filter(
    (f) => f.mimeType === "application/vnd.google-apps.folder"
  );
  const directFiles = rootFiles.filter(
    (f) => f.mimeType !== "application/vnd.google-apps.folder"
  );

  // Also check 1 level of subfolders so organized CVs/Notes folders are discovered
  const nestedResults: DriveFileEntry[] = [...directFiles];
  for (const sub of folders.slice(0, 6)) {
    const subQuery = `'${sub.id}' in parents and trashed = false`;
    const subParams = new URLSearchParams({
      q: subQuery,
      fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
      pageSize: "50",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    const subData = await fetchGoogleJson<{ files?: DriveFileEntry[] }>(
      `https://www.googleapis.com/drive/v3/files?${subParams.toString()}`,
      accessToken
    );
    for (const sf of subData.files || []) {
      if (sf.mimeType !== "application/vnd.google-apps.folder") {
        nestedResults.push({ ...sf, folderName: sub.name });
      }
    }
  }

  return nestedResults;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function downloadDriveFileForExtraction(
  accessToken: string,
  file: DriveFileEntry
): Promise<{
  id: string;
  name: string;
  mimeType: string;
  textContent?: string;
  base64Data?: string;
}> {
  if (file.mimeType === "application/vnd.google-apps.document") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Failed to export Google Doc "${file.name}" (${res.status})`);
    return {
      id: file.id,
      name: file.name,
      mimeType: "text/plain",
      textContent: await res.text(),
    };
  }

  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Failed to export Google Sheet "${file.name}" (${res.status})`);
    return {
      id: file.id,
      name: file.name,
      mimeType: "text/csv",
      textContent: await res.text(),
    };
  }

  if (file.mimeType === "application/vnd.google-apps.presentation") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Failed to export Google Slides "${file.name}" (${res.status})`);
    return {
      id: file.id,
      name: file.name,
      mimeType: "text/plain",
      textContent: await res.text(),
    };
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Failed to download "${file.name}" (${res.status})`);

  if (
    file.mimeType.startsWith("text/") ||
    file.mimeType === "application/json" ||
    file.name.endsWith(".md") ||
    file.name.endsWith(".txt") ||
    file.name.endsWith(".csv")
  ) {
    return {
      id: file.id,
      name: file.name,
      mimeType: "text/plain",
      textContent: await res.text(),
    };
  }

  if (
    file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".docx")
  ) {
    const buffer = await res.arrayBuffer();
    const extractedText = await extractTextFromDocxBuffer(buffer);
    return {
      id: file.id,
      name: file.name,
      mimeType: "text/plain",
      textContent: extractedText,
    };
  }

  if (file.mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const buffer = await res.arrayBuffer();
    try {
      const extractedText = await extractTextFromPdfBuffer(buffer);
      if (extractedText.length >= 80) {
        return {
          id: file.id,
          name: file.name,
          mimeType: "text/plain",
          textContent: extractedText,
        };
      }
    } catch {
      // Fall back to compact inline PDF if text extraction failed
    }
    if (buffer.byteLength > 4 * 1024 * 1024) {
      throw new Error(
        `"${file.name}" appears to be a scanned/image PDF over 4MB. Open it as a Google Doc or paste its text directly.`
      );
    }
    return {
      id: file.id,
      name: file.name,
      mimeType: "application/pdf",
      base64Data: arrayBufferToBase64(buffer),
    };
  }

  if (file.mimeType.startsWith("image/")) {
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > 4 * 1024 * 1024) {
      throw new Error(`"${file.name}" exceeds 4MB image limit.`);
    }
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      base64Data: arrayBufferToBase64(buffer),
    };
  }

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    textContent: `File metadata only: ${file.name} (${file.mimeType}). Link: ${file.webViewLink || ""}`,
  };
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  tabs: string[];
}> {
  const data = await fetchGoogleJson<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: Array<{ properties: { title: string } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`,
    accessToken
  );

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || "CareerJogger Tracker",
    spreadsheetUrl:
      data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    tabs: (data.sheets || []).map((s) => s.properties.title),
  };
}

export async function createTrackerSpreadsheet(
  accessToken: string,
  title: string
): Promise<{
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  tabs: string[];
}> {
  const data = await fetchGoogleJson<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties: { title: string };
    sheets: Array<{ properties: { title: string } }>;
  }>(`https://sheets.googleapis.com/v4/spreadsheets`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: "Target Pipeline" } },
        { properties: { title: "Applications Log" } },
      ],
    }),
  });

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || title,
    spreadsheetUrl: data.spreadsheetUrl,
    tabs: (data.sheets || []).map((s) => s.properties.title),
  };
}

async function ensureTabsExist(
  accessToken: string,
  spreadsheetId: string,
  desiredTabs: string[]
) {
  const meta = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const missing = desiredTabs.filter((t) => !meta.tabs.includes(t));
  if (missing.length === 0) return;

  await fetchGoogleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: missing.map((title) => ({
          addSheet: { properties: { title } },
        })),
      }),
    }
  );
}

export async function pushTrackerToSheet(
  accessToken: string,
  spreadsheetId: string,
  pipelineTab: string,
  logTab: string,
  pipeline: TargetPipelineEntry[],
  applications: ApplicationLogEntry[]
): Promise<void> {
  await ensureTabsExist(accessToken, spreadsheetId, [pipelineTab, logTab]);

  const pipelineRows: (string | number)[][] = [
    [
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
    ],
    ...pipeline.map((p) => [
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
    ]),
  ];

  const logRows: string[][] = [
    [
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
    ],
    ...applications.map((a) => [
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
    ]),
  ];

  // Clear existing ranges first so deleted rows don't linger
  await fetchGoogleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchClear`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ranges: [`'${pipelineTab}'!A:Z`, `'${logTab}'!A:Z`],
      }),
    }
  );

  await fetchGoogleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [
          { range: `'${pipelineTab}'!A1`, values: pipelineRows },
          { range: `'${logTab}'!A1`, values: logRows },
        ],
      }),
    }
  );
}

export async function pullTrackerFromSheet(
  accessToken: string,
  spreadsheetId: string,
  pipelineTab: string,
  logTab: string
): Promise<{
  pipeline: TargetPipelineEntry[];
  applications: ApplicationLogEntry[];
}> {
  const ranges = [
    `ranges=${encodeURIComponent(`'${pipelineTab}'!A1:N500`)}`,
    `ranges=${encodeURIComponent(`'${logTab}'!A1:L1000`)}`,
  ].join("&");

  const data = await fetchGoogleJson<{
    valueRanges?: Array<{ values?: string[][] }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${ranges}`,
    accessToken
  );

  const pipelineRaw = data.valueRanges?.[0]?.values || [];
  const logRaw = data.valueRanges?.[1]?.values || [];

  const pipeline: TargetPipelineEntry[] = pipelineRaw
    .slice(1)
    .filter((r) => r.some((c) => (c || "").trim() !== ""))
    .map((r, idx) => ({
      id: `sheet-pipe-${idx}`,
      verificationStatus: (r[0] || "").trim(),
      company: (r[1] || "").trim(),
      role: (r[2] || "").trim(),
      matchScore: Number.parseInt((r[3] || "0").trim(), 10) || 0,
      location: (r[4] || "").trim(),
      salary: (r[5] || "").trim(),
      cvVersion: (r[6] || "").trim(),
      applicationMethod: (r[7] || "").trim(),
      targetContact: (r[8] || "").trim(),
      outreachStatus: (r[9] || "").trim(),
      nextActionDate: (r[10] || "").trim(),
      nextAction: (r[11] || "").trim(),
      applicationLink: (r[12] || "").trim(),
      notes: (r[13] || "").trim(),
    }));

  const applications: ApplicationLogEntry[] = logRaw
    .slice(1)
    .filter((r) => r.some((c) => (c || "").trim() !== ""))
    .map((r, idx) => ({
      id: `sheet-app-${idx}`,
      role: (r[0] || "").trim(),
      company: (r[1] || "").trim(),
      location: (r[2] || "").trim(),
      siteLink: (r[3] || "").trim(),
      deadline: (r[4] || "").trim(),
      submissionDate: (r[5] || "").trim(),
      status: (r[6] || "").trim(),
      notes: (r[7] || "").trim(),
      companyProfile: (r[8] || "").trim(),
      source: (r[9] || "").trim(),
      otherLinks: (r[10] || "").trim(),
      interviewPrep: (r[11] || "").trim(),
    }));

  return { pipeline, applications };
}

async function findDriveItemByName(
  accessToken: string,
  name: string,
  mimeType: string,
  parentFolderId?: string
): Promise<{ id: string; name: string; webViewLink: string } | null> {
  const escaped = name.replace(/'/g, "\\'");
  const clauses = [
    `name = '${escaped}'`,
    `mimeType = '${mimeType}'`,
    "trashed = false",
  ];
  if (parentFolderId) {
    clauses.push(`'${parentFolderId}' in parents`);
  }
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,webViewLink)",
    pageSize: "5",
    orderBy: "modifiedTime desc",
  });
  const res = await fetchGoogleJson<{
    files?: Array<{ id: string; name: string; webViewLink?: string }>;
  }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, accessToken);
  const found = res.files?.[0];
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    webViewLink:
      found.webViewLink ||
      (mimeType === "application/vnd.google-apps.folder"
        ? `https://drive.google.com/drive/folders/${found.id}`
        : `https://docs.google.com/spreadsheets/d/${found.id}/edit`),
  };
}

export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentFolderId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const created = await fetchGoogleJson<{
    id: string;
    name: string;
    webViewLink?: string;
  }>(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    }
  );

  return {
    id: created.id,
    name: created.name,
    webViewLink:
      created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
  };
}

async function findOrCreateFolder(
  accessToken: string,
  name: string,
  parentFolderId?: string
): Promise<{ id: string; name: string; webViewLink: string }> {
  const existing = await findDriveItemByName(
    accessToken,
    name,
    "application/vnd.google-apps.folder",
    parentFolderId
  );
  if (existing) return existing;
  return createDriveFolder(accessToken, name, parentFolderId);
}

export async function moveDriveFileToFolder(
  accessToken: string,
  fileId: string,
  targetFolderId: string
): Promise<void> {
  const meta = await fetchGoogleJson<{ parents?: string[] }>(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
    accessToken
  );
  const previousParents = (meta.parents || []).join(",");
  const query = new URLSearchParams({
    addParents: targetFolderId,
    ...(previousParents ? { removeParents: previousParents } : {}),
    fields: "id,parents",
  });

  await fetchGoogleJson(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${query.toString()}`,
    accessToken,
    { method: "PATCH" }
  );
}

export async function provisionDriveWorkspace(
  accessToken: string,
  rootFolderName = "CareerJogger Workspace",
  trackerTitle = "CareerJogger — Job Tracker"
): Promise<{
  workspace: DriveWorkspaceConfig;
  sheetConfig: SheetSyncConfig;
  reusedExisting: boolean;
}> {
  const existingRoot = await findDriveItemByName(
    accessToken,
    rootFolderName,
    "application/vnd.google-apps.folder"
  );
  const root =
    existingRoot || (await createDriveFolder(accessToken, rootFolderName));

  const [trackers, cvs, coverLetters, sources] = await Promise.all([
    findOrCreateFolder(accessToken, "Trackers", root.id),
    findOrCreateFolder(accessToken, "Tailored CVs", root.id),
    findOrCreateFolder(accessToken, "Cover Letters", root.id),
    findOrCreateFolder(accessToken, "Source CVs & Notes", root.id),
  ]);

  const existingSheet = await findDriveItemByName(
    accessToken,
    trackerTitle,
    "application/vnd.google-apps.spreadsheet",
    trackers.id
  );

  let sheetConfig: SheetSyncConfig;
  if (existingSheet) {
    const meta = await getSpreadsheetMetadata(accessToken, existingSheet.id);
    sheetConfig = {
      spreadsheetId: meta.spreadsheetId,
      spreadsheetTitle: meta.title,
      spreadsheetUrl: meta.spreadsheetUrl,
      pipelineTab: meta.tabs.includes("Target Pipeline")
        ? "Target Pipeline"
        : meta.tabs[0] || "Target Pipeline",
      logTab: meta.tabs.includes("Applications Log")
        ? "Applications Log"
        : meta.tabs[1] || meta.tabs[0] || "Applications Log",
      lastSyncedAt: new Date().toISOString(),
    };
  } else {
    const createdSheet = await createTrackerSpreadsheet(accessToken, trackerTitle);
    await moveDriveFileToFolder(accessToken, createdSheet.spreadsheetId, trackers.id);
    await pushTrackerToSheet(
      accessToken,
      createdSheet.spreadsheetId,
      "Target Pipeline",
      "Applications Log",
      [],
      []
    );
    sheetConfig = {
      spreadsheetId: createdSheet.spreadsheetId,
      spreadsheetTitle: createdSheet.title,
      spreadsheetUrl: createdSheet.spreadsheetUrl,
      pipelineTab: "Target Pipeline",
      logTab: "Applications Log",
      lastSyncedAt: new Date().toISOString(),
    };
  }

  return {
    reusedExisting: Boolean(existingRoot),
    workspace: {
      rootFolderId: root.id,
      rootFolderName: root.name,
      rootFolderUrl: root.webViewLink,
      trackersFolderId: trackers.id,
      cvsFolderId: cvs.id,
      coverLettersFolderId: coverLetters.id,
      sourcesFolderId: sources.id,
      createdAt: new Date().toISOString(),
    },
    sheetConfig,
  };
}

export interface DocBlock {
  text: string;
  style?: "TITLE" | "SUBTITLE" | "HEADING_2" | "BULLET" | "BODY";
}

function buildDocsBatchRequests(blocks: DocBlock[]): Array<Record<string, unknown>> {
  const nonEmpty = blocks.filter((b) => b.text.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  let cursor = 1;
  const spans: Array<{
    start: number;
    end: number;
    style: DocBlock["style"];
    line: string;
  }> = [];

  for (const block of nonEmpty) {
    const cleanText = block.text.replace(/\r\n/g, "\n").trim();
    const line = `${cleanText}\n`;
    const start = cursor;
    const end = cursor + line.length;
    spans.push({ start, end, style: block.style || "BODY", line });
    cursor = end;
  }

  const fullText = spans.map((s) => s.line).join("");
  const requests: Array<Record<string, unknown>> = [
    {
      insertText: {
        location: { index: 1 },
        text: fullText,
      },
    },
  ];

  for (const span of spans) {
    if (span.style === "TITLE") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: span.start, endIndex: span.end },
          paragraphStyle: { namedStyleType: "HEADING_1", spaceBelow: { magnitude: 4, unit: "PT" } },
          fields: "namedStyleType,spaceBelow",
        },
      });
    } else if (span.style === "SUBTITLE") {
      requests.push({
        updateTextStyle: {
          range: { startIndex: span.start, endIndex: span.end - 1 },
          textStyle: {
            fontSize: { magnitude: 10, unit: "PT" },
            foregroundColor: {
              color: { rgbColor: { red: 0.35, green: 0.4, blue: 0.48 } },
            },
          },
          fields: "fontSize,foregroundColor",
        },
      });
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: span.start, endIndex: span.end },
          paragraphStyle: { spaceBelow: { magnitude: 10, unit: "PT" } },
          fields: "spaceBelow",
        },
      });
    } else if (span.style === "HEADING_2") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: span.start, endIndex: span.end },
          paragraphStyle: {
            namedStyleType: "HEADING_2",
            spaceAbove: { magnitude: 10, unit: "PT" },
            spaceBelow: { magnitude: 3, unit: "PT" },
          },
          fields: "namedStyleType,spaceAbove,spaceBelow",
        },
      });
    } else if (span.style === "BULLET") {
      requests.push({
        createParagraphBullets: {
          range: { startIndex: span.start, endIndex: span.end },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    } else {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: span.start, endIndex: span.end },
          paragraphStyle: { spaceBelow: { magnitude: 6, unit: "PT" } },
          fields: "spaceBelow",
        },
      });
    }
  }

  return requests;
}

export async function createFormattedGoogleDoc(
  accessToken: string,
  opts: {
    title: string;
    parentFolderId?: string;
    blocks: DocBlock[];
  }
): Promise<{ documentId: string; title: string; webViewLink: string }> {
  const metadata: Record<string, unknown> = {
    name: opts.title,
    mimeType: "application/vnd.google-apps.document",
  };
  if (opts.parentFolderId) {
    metadata.parents = [opts.parentFolderId];
  }

  const created = await fetchGoogleJson<{
    id: string;
    name: string;
    webViewLink?: string;
  }>(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    }
  );

  const requests = buildDocsBatchRequests(opts.blocks);
  if (requests.length > 0) {
    await fetchGoogleJson(
      `https://docs.googleapis.com/v1/documents/${created.id}:batchUpdate`,
      accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      }
    );
  }

  return {
    documentId: created.id,
    title: created.name,
    webViewLink:
      created.webViewLink || `https://docs.google.com/document/d/${created.id}/edit`,
  };
}

export async function overwriteFormattedGoogleDoc(
  accessToken: string,
  documentId: string,
  blocks: DocBlock[]
): Promise<void> {
  const doc = await fetchGoogleJson<{
    body?: { content?: Array<{ endIndex?: number }> };
  }>(
    `https://docs.googleapis.com/v1/documents/${documentId}?fields=body.content`,
    accessToken
  );

  const elements = doc.body?.content || [];
  const lastEnd = elements[elements.length - 1]?.endIndex || 1;
  const requests: Array<Record<string, unknown>> = [];

  if (lastEnd > 2) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex: lastEnd - 1 },
      },
    });
  }

  requests.push(...buildDocsBatchRequests(blocks));

  if (requests.length > 0) {
    await fetchGoogleJson(
      `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
      accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      }
    );
  }
}

export async function exportGoogleDocAsPdf(
  accessToken: string,
  documentId: string
): Promise<{ blob: Blob; base64: string; byteLength: number }> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${documentId}/export?mimeType=application/pdf`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "Google Workspace session expired (401). Sign out and sign in with Google again."
      );
    }
    throw new Error(`Failed to export Google Doc to PDF (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  const buffer = await blob.arrayBuffer();
  return {
    blob,
    base64: arrayBufferToBase64(buffer),
    byteLength: buffer.byteLength,
  };
}

export async function uploadSourceFileToDrive(
  accessToken: string,
  opts: {
    file: File;
    parentFolderId: string;
  }
): Promise<{ id: string; name: string; webViewLink: string }> {
  const metadata = {
    name: opts.file.name,
    parents: [opts.parentFolderId],
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  form.append("file", opts.file);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Failed to upload "${opts.file.name}" to Google Drive (${res.status}): ${msg.slice(0, 120)}`);
  }
  const created = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return {
    id: created.id,
    name: created.name,
    webViewLink: created.webViewLink || `https://drive.google.com/file/d/${created.id}/view`,
  };
}

export async function upsertDriveJsonFile(
  accessToken: string,
  opts: {
    fileId?: string;
    name: string;
    parentFolderId: string;
    data: unknown;
  }
): Promise<{ id: string; name: string; webViewLink: string }> {
  let targetId = opts.fileId;
  if (!targetId) {
    const existing = await findDriveItemByName(
      accessToken,
      opts.name,
      "application/json",
      opts.parentFolderId
    );
    if (existing) targetId = existing.id;
  }

  const jsonBody = JSON.stringify(opts.data, null, 2);

  if (targetId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${targetId}?uploadType=media&fields=id,name,webViewLink`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: jsonBody,
      }
    );
    if (res.ok) {
      const updated = (await res.json()) as { id: string; name: string; webViewLink?: string };
      return {
        id: updated.id,
        name: updated.name,
        webViewLink: updated.webViewLink || `https://drive.google.com/file/d/${updated.id}/view`,
      };
    }
  }

  const form = new FormData();
  form.append(
    "metadata",
    new Blob(
      [
        JSON.stringify({
          name: opts.name,
          mimeType: "application/json",
          parents: [opts.parentFolderId],
        }),
      ],
      { type: "application/json" }
    )
  );
  form.append("file", new Blob([jsonBody], { type: "application/json" }));

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );
  if (!res.ok) {
    throw new Error(`Failed to save ${opts.name} to Google Drive (${res.status}).`);
  }
  const created = (await res.json()) as { id: string; name: string; webViewLink?: string };
  return {
    id: created.id,
    name: created.name,
    webViewLink: created.webViewLink || `https://drive.google.com/file/d/${created.id}/view`,
  };
}

export async function appendRowToApplicationSheet(
  accessToken: string,
  spreadsheetId: string,
  logTab: string,
  entry: ApplicationLogEntry
): Promise<void> {
  await ensureTabsExist(accessToken, spreadsheetId, [logTab]);
  const row = [
    entry.role,
    entry.company,
    entry.location,
    entry.siteLink,
    entry.deadline,
    entry.submissionDate,
    entry.status,
    entry.notes,
    entry.companyProfile,
    entry.source,
    entry.otherLinks || [entry.cvDocUrl, entry.coverDocUrl].filter(Boolean).join(" | "),
    entry.interviewPrep,
  ];
  await fetchGoogleJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(
      logTab
    )}'!A1:append?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    }
  );
}

