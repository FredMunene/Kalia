import JSZip from "jszip";
import {
  ApplicationLogEntry,
  FactItem,
  GeneratedDocumentEntry,
  ProfileDefaults,
} from "../types/career";

export interface ExtensionBuildOptions {
  apiBaseUrl: string;
  includeLiveAi: boolean;
  profile: ProfileDefaults;
  facts: FactItem[];
  applications: ApplicationLogEntry[];
  documents?: GeneratedDocumentEntry[];
  firebaseConfig?: {
    apiKey: string;
    projectId: string;
    firestoreDatabaseId: string;
  };
}

export async function generateChromeExtensionZip(
  opts: ExtensionBuildOptions
): Promise<Blob> {
  const zip = new JSZip();

  const manifest = {
    manifest_version: 3,
    name: "CareerJogger — Master CV Autofill & Tracker",
    version: "2.0.0",
    description:
      "Install once. Syncs with your CareerJogger account, reads job questions, drafts & fills answers for review, attaches Drive CV/Cover PDFs, and logs to your Sheet tracker.",
    permissions: ["activeTab", "storage", "scripting"],
    host_permissions: ["https://*/*", "http://*/*"],
    action: {
      default_popup: "popup.html",
      default_title: "CareerJogger",
    },
    content_scripts: [
      {
        matches: ["https://*/*", "http://*/*"],
        js: ["content.js"],
        run_at: "document_idle",
        all_frames: true,
      },
    ],
  };

  const configJson = {
    apiBaseUrl: opts.apiBaseUrl.replace(/\/+$/, ""),
    includeLiveAi: opts.includeLiveAi,
    firebaseConfig: opts.firebaseConfig || null,
    exportedAt: new Date().toISOString(),
  };

  const appsIndex = opts.applications.map((a) => ({
    id: a.id,
    company: a.company,
    role: a.role,
    url: a.siteLink,
    cvVersion: a.cvVersion || "",
    status: a.status,
    notes: [a.notes, a.interviewPrep].filter(Boolean).join(" | "),
  }));

  const contentScript = `(() => {
  if (window.__careerJoggerLoaded) return;
  window.__careerJoggerLoaded = true;

  // Web-App-to-Extension Account Sync Bridge
  window.addEventListener("message", async (event) => {
    if (!event || !event.data) return;
    if (event.data.type === "CJ_WEB_PING") {
      window.postMessage({ type: "CJ_WEB_PONG", version: "2.0.0" }, "*");
      return;
    }
    if (event.data.type === "CJ_WEB_AUTH_SYNC" && event.data.payload) {
      try {
        await chrome.storage.local.set({ cj_session: event.data.payload });
        window.postMessage(
          { type: "CJ_WEB_AUTH_SYNC_ACK", ok: true, email: event.data.payload.email || "" },
          "*"
        );
      } catch (err) {
        window.postMessage(
          { type: "CJ_WEB_AUTH_SYNC_ACK", ok: false, error: err && err.message ? err.message : "Storage failed" },
          "*"
        );
      }
    }
  });

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function getFieldLabel(el) {
    const aria = el.getAttribute("aria-label") || "";
    const placeholder = el.getAttribute("placeholder") || "";
    const nameAttr = el.getAttribute("name") || "";
    const idAttr = el.getAttribute("id") || "";
    let labelText = "";
    if (idAttr) {
      const explicitLabel = document.querySelector('label[for="' + CSS.escape(idAttr) + '"]');
      if (explicitLabel) labelText = explicitLabel.innerText || "";
    }
    if (!labelText) {
      const parentLabel = el.closest("label");
      if (parentLabel) labelText = parentLabel.innerText || "";
    }
    if (!labelText) {
      const listItem = el.closest('[role="listitem"]');
      if (listItem) {
        const heading = listItem.querySelector('[role="heading"]');
        if (heading) labelText = heading.innerText || "";
      }
    }
    if (!labelText) {
      const fieldWrap = el.closest(".application-question, .field, .form-group, li, div");
      if (fieldWrap) {
        const lbl = fieldWrap.querySelector("label, .label, legend, h3, h4");
        if (lbl && lbl !== el) labelText = lbl.innerText || "";
      }
    }
    return [labelText, aria, placeholder, nameAttr, idAttr]
      .join(" ")
      .replace(/\\s+/g, " ")
      .trim();
  }

  function scanPage() {
    const inputs = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea'
      )
    );
    const fields = [];
    const fileInputs = [];

    inputs.forEach((el, idx) => {
      if (el.type === "file") {
        const label = getFieldLabel(el);
        el.dataset.cjFileIndex = String(idx);
        fileInputs.push({ index: idx, label: label || "Resume / CV Upload" });
        return;
      }
      if (el.offsetParent === null) return;
      const label = getFieldLabel(el);
      el.dataset.cjIndex = String(idx);
      const isLongForm =
        el.tagName === "TEXTAREA" ||
        (label && label.length > 35) ||
        /why|describe|tell us|project|experience|motivation|cover|proud|challenge/i.test(label);
      fields.push({
        index: idx,
        tag: el.tagName.toLowerCase(),
        type: el.type || "text",
        label: label || "Field #" + (idx + 1),
        value: el.value || "",
        isLongForm,
      });
    });

    return {
      url: window.location.href,
      title: document.title,
      fields,
      fileInputs,
    };
  }

  function matchStandardProfileValue(labelLower, profile) {
    if (!profile) return null;
    if (/full\\s*name|your\\s*name|\\bname\\b/i.test(labelLower) && !/company|first|last|middle|user/i.test(labelLower)) {
      return profile.fullName || null;
    }
    if (/first\\s*name|given\\s*name/i.test(labelLower) && profile.fullName) {
      return profile.fullName.split(/\\s+/)[0] || null;
    }
    if (/last\\s*name|surname|family\\s*name/i.test(labelLower) && profile.fullName) {
      const parts = profile.fullName.trim().split(/\\s+/);
      return parts.length > 1 ? parts.slice(1).join(" ") : null;
    }
    if (/email|e-mail/i.test(labelLower)) return profile.email || null;
    if (/phone|mobile|telephone|whatsapp/i.test(labelLower)) return profile.phone || null;
    if (/linkedin/i.test(labelLower)) return profile.linkedinUrl || null;
    if (/github/i.test(labelLower)) return profile.githubUrl || null;
    if (/twitter|\\bx\\.com\\b|\\bx handle\\b/i.test(labelLower)) return profile.xUrl || null;
    if (/portfolio|website|personal\\s*site|blog/i.test(labelLower)) return profile.portfolioUrl || null;
    if (/location|city|country|address|based/i.test(labelLower)) return profile.location || null;
    if (/work\\s*auth|visa|sponsorship/i.test(labelLower)) return profile.workAuth || null;
    if (/years.*experience/i.test(labelLower)) return profile.yearsExperience || null;
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "CJ_SCAN") {
      sendResponse(scanPage());
      return true;
    }
    if (msg.type === "CJ_AUTOFILL_STANDARD") {
      const { profile } = msg;
      const scan = scanPage();
      let filledCount = 0;
      for (const f of scan.fields) {
        const el = document.querySelector('[data-cj-index="' + f.index + '"]');
        if (!el || el.value.trim()) continue;
        const val = matchStandardProfileValue(f.label.toLowerCase(), profile);
        if (val) {
          setNativeValue(el, val);
          filledCount++;
        }
      }
      sendResponse({ filledCount, fileInputs: scan.fileInputs });
      return true;
    }
    if (msg.type === "CJ_FILL_FIELD") {
      const el = document.querySelector('[data-cj-index="' + msg.index + '"]');
      if (el) {
        setNativeValue(el, msg.value || "");
        if (msg.scroll) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return true;
    }
    if (msg.type === "CJ_ATTACH_FILE") {
      try {
        const el = document.querySelector('[data-cj-file-index="' + msg.fileIndex + '"]');
        if (!el) {
          sendResponse({ ok: false, reason: "File upload input not found on page." });
          return true;
        }
        const binary = atob(msg.base64Data || "");
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const file = new File([bytes], msg.fileName || "CareerJogger-CV.pdf", {
          type: msg.mimeType || "application/pdf",
        });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        sendResponse({
          ok: el.files && el.files.length > 0,
          assignedCount: el.files ? el.files.length : 0,
        });
      } catch (err) {
        sendResponse({ ok: false, reason: err && err.message ? err.message : "Could not inject file." });
      }
      return true;
    }
  });
})();`;

  const popupHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CareerJogger</title>
  <link rel="stylesheet" href="popup.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand-wrap">
      <div class="brand">CareerJogger</div>
      <div id="syncBadge" class="sync-meta">Checking account sync...</div>
    </div>
    <div class="top-actions">
      <button id="syncAccountBtn" class="btn-sm" title="Refresh live Master CV & facts from account">Sync</button>
    </div>
  </header>

  <section id="connectPrompt" class="connect-box hidden">
    <div class="item-title">Connect Your CareerJogger Account Once</div>
    <div class="item-meta">Open CareerJogger, sign in with Google, and click "Connect Extension"—or paste your Connection Key below.</div>
    <div class="actions-row" style="margin-top:6px;margin-bottom:0;">
      <input id="connectKeyInput" class="input" style="margin-bottom:0;flex:1;" type="text" placeholder="Paste Connection Key..." />
      <button id="connectKeyBtn" class="btn-primary">Connect</button>
    </div>
  </section>

  <section id="matchedBanner" class="context-box hidden"></section>

  <nav class="tabs">
    <button class="tab active" data-tab="fill">Auto-Fill & Questions</button>
    <button class="tab" data-tab="facts">Master Facts</button>
    <button class="tab" data-tab="log">Log App</button>
  </nav>

  <main>
    <section id="tab-fill" class="panel active">
      <div class="actions-row">
        <button id="autofillBtn" class="btn-primary">Auto-Fill Profile</button>
        <button id="draftAllBtn" class="btn-primary-outline">Draft & Fill Questions</button>
        <button id="rescanBtn" class="btn-secondary">Rescan</button>
      </div>
      <div id="fillStatus" class="status-line">Scanning current tab...</div>
      <div id="fileReminder" class="reminder hidden"></div>
      <div id="detectedFields" class="list"></div>
    </section>

    <section id="tab-facts" class="panel">
      <input id="factSearch" class="input" type="search" placeholder="Filter career facts, metrics, links..." />
      <div id="factsList" class="list"></div>
    </section>

    <section id="tab-log" class="panel">
      <label class="label" for="logCompany">Company</label>
      <input id="logCompany" class="input" type="text" placeholder="Company name" />
      <label class="label" for="logRole">Role Title</label>
      <input id="logRole" class="input" type="text" placeholder="Role title" />
      <label class="label" for="logNotes">Application Notes</label>
      <textarea id="logNotes" class="textarea" rows="3" placeholder="Notes, CV version, recruiter contact..."></textarea>
      <div class="actions-row">
        <button id="logSubmitBtn" class="btn-primary">Log Application to Tracker</button>
      </div>
      <div id="logStatus" class="status-line"></div>
    </section>
  </main>

  <script src="popup.js"></script>
</body>
</html>`;

  const popupCss = `* { box-sizing: border-box; }
body {
  margin: 0;
  width: 410px;
  min-height: 490px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #0f172a;
  background: #ffffff;
  font-size: 13px;
  line-height: 1.45;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
.brand-wrap { min-width: 0; }
.brand { font-weight: 700; font-size: 14px; letter-spacing: -0.01em; }
.sync-meta { font-size: 11px; color: #64748b; max-width: 290px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connect-box {
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #fffbeb;
}
.context-box {
  padding: 8px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  font-size: 12px;
}
.hidden { display: none; }
.tabs {
  display: flex;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 10px;
  gap: 6px;
}
.tab {
  border: none;
  background: transparent;
  padding: 9px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tab.active { color: #0f172a; border-bottom-color: #0f172a; }
main { padding: 12px 14px; }
.panel { display: none; }
.panel.active { display: block; }
.actions-row { display: flex; gap: 6px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.btn-primary {
  background: #0f172a;
  color: #ffffff;
  border: 1px solid #0f172a;
  border-radius: 6px;
  padding: 7px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary-outline {
  background: #ffffff;
  color: #0f172a;
  border: 1px solid #0f172a;
  border-radius: 6px;
  padding: 7px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-secondary {
  background: #ffffff;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.btn-sm {
  background: #ffffff;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.btn-primary:disabled, .btn-primary-outline:disabled { opacity: 0.5; cursor: not-allowed; }
.status-line { font-size: 12px; color: #475569; margin-bottom: 8px; }
.reminder {
  padding: 9px 10px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  border-radius: 6px;
  font-size: 12px;
  color: #0f172a;
  margin-bottom: 10px;
}
.input, .textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 12px;
  font-family: inherit;
  margin-bottom: 10px;
}
.label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; }
.list { display: flex; flex-direction: column; gap: 8px; max-height: 315px; overflow-y: auto; }
.item {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 9px 10px;
  background: #ffffff;
}
.item-title { font-weight: 600; font-size: 12px; margin-bottom: 4px; color: #0f172a; }
.item-meta { font-size: 11px; color: #64748b; margin-bottom: 4px; }
.item-body { font-size: 12px; color: #334155; margin-bottom: 6px; white-space: pre-wrap; }
.item-actions { display: flex; gap: 6px; flex-wrap: wrap; }`;

  const popupJs = `let config = {};
let session = null;
let profile = {};
let facts = [];
let apps = [];
let docs = [];
let masterCv = null;
let workspaceConfig = null;
let sheetConfig = null;
let activeTabId = null;
let activeUrl = "";
let activeTitle = "";
let lastScan = null;
let sessionTokensUsed = 0;

async function loadJson(path) {
  const res = await fetch(chrome.runtime.getURL(path));
  return res.json();
}

function getHostname(url) {
  try { return new URL(url).hostname.replace(/^www\\./, ""); } catch { return ""; }
}

function decodeFirestoreValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return Boolean(v.booleanValue);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in v) {
    const out = {};
    const fields = v.mapValue.fields || {};
    for (const k of Object.keys(fields)) {
      out[k] = decodeFirestoreValue(fields[k]);
    }
    return out;
  }
  return null;
}

function decodeFirestoreDoc(doc) {
  const out = {};
  const fields = doc.fields || {};
  for (const k of Object.keys(fields)) {
    out[k] = decodeFirestoreValue(fields[k]);
  }
  return out;
}

function encodeFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "string") return { stringValue: val };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const k of Object.keys(val)) {
      fields[k] = encodeFirestoreValue(val[k]);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

async function ensureFreshIdToken() {
  if (!session || !session.firebaseConfig || !session.refreshToken) {
    return session?.idToken || null;
  }
  try {
    const res = await fetch(
      "https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(session.firebaseConfig.apiKey),
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(session.refreshToken),
      }
    );
    if (!res.ok) return session.idToken;
    const data = await res.json();
    if (data.id_token) {
      session.idToken = data.id_token;
      if (data.refresh_token) session.refreshToken = data.refresh_token;
      await chrome.storage.local.set({ cj_session: session });
      return session.idToken;
    }
  } catch {
    // Keep existing idToken
  }
  return session.idToken;
}

function getFirestoreBase() {
  const fc = session?.firebaseConfig || config.firebaseConfig;
  if (!fc || !fc.projectId || !fc.firestoreDatabaseId) return null;
  return "https://firestore.googleapis.com/v1/projects/" + fc.projectId + "/databases/" + fc.firestoreDatabaseId + "/documents";
}

async function syncFromCloud() {
  if (!session || !session.uid) return false;
  const badge = document.getElementById("syncBadge");
  badge.textContent = "Syncing " + (session.email || "account") + "...";
  const token = await ensureFreshIdToken();
  const base = getFirestoreBase();
  if (!token || !base) {
    badge.textContent = "Connected: " + (session.email || session.uid);
    return false;
  }

  try {
    const headers = { Authorization: "Bearer " + token };
    const [userRes, factsRes, appsRes, docsRes] = await Promise.all([
      fetch(base + "/users/" + session.uid, { headers }),
      fetch(base + "/users/" + session.uid + "/facts?pageSize=100", { headers }),
      fetch(base + "/users/" + session.uid + "/applications?pageSize=100", { headers }),
      fetch(base + "/users/" + session.uid + "/generatedDocs?pageSize=50", { headers }),
    ]);

    if (userRes.ok) {
      const userData = decodeFirestoreDoc(await userRes.json());
      if (userData.profile) profile = userData.profile;
      if (userData.masterCv) masterCv = userData.masterCv;
      if (userData.workspaceConfig) workspaceConfig = userData.workspaceConfig;
      if (userData.sheetConfig) sheetConfig = userData.sheetConfig;
    }
    if (factsRes.ok) {
      const fJson = await factsRes.json();
      facts = (fJson.documents || []).map(decodeFirestoreDoc);
    }
    if (appsRes.ok) {
      const aJson = await appsRes.json();
      apps = (aJson.documents || []).map(a => {
        const d = decodeFirestoreDoc(a);
        return { ...d, url: d.siteLink || "" };
      });
    }
    if (docsRes.ok) {
      const dJson = await docsRes.json();
      docs = (dJson.documents || []).map(decodeFirestoreDoc);
    }

    await chrome.storage.local.set({
      cj_cached_workspace: { profile, facts, apps, docs, masterCv, workspaceConfig, sheetConfig },
    });
    badge.textContent = "Synced: " + (session.email || "account") + " (" + facts.length + " facts)";
    document.getElementById("connectPrompt").classList.add("hidden");
    return true;
  } catch (err) {
    badge.textContent = "Offline cache (" + (session.email || "signed in") + ")";
    return false;
  }
}

async function incrementStatsInFirestore(appInc, usage) {
  if (!session || !session.uid) return;
  const base = getFirestoreBase();
  const token = await ensureFreshIdToken();
  if (!base || !token) return;
  const pAdd = Number(usage?.promptTokenCount || 0);
  const oAdd = Number(usage?.candidatesTokenCount || 0);
  const tAdd = Number(usage?.totalTokenCount || (pAdd + oAdd));
  if (appInc === 0 && tAdd === 0) return;

  try {
    const docUrl = base + "/userStats/" + session.uid;
    const getRes = await fetch(docUrl, { headers: { Authorization: "Bearer " + token } });
    if (!getRes.ok) return;
    const prev = decodeFirestoreDoc(await getRes.json());
    const dbRoot = base.replace(/\\/documents$/, "");
    const docPath = base.replace("https://firestore.googleapis.com/v1/", "") + "/userStats/" + session.uid;

    await fetch(dbRoot + "/documents:commit", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        writes: [
          {
            update: {
              name: docPath,
              fields: {
                uid: encodeFirestoreValue(session.uid),
                email: encodeFirestoreValue(prev.email || session.email || ""),
                displayName: encodeFirestoreValue(prev.displayName || session.displayName || "Applicant"),
                applicationCount: encodeFirestoreValue(Number(prev.applicationCount || 0) + appInc),
                masterCvUploaded: encodeFirestoreValue(Boolean(prev.masterCvUploaded)),
                driveWorkspaceLinked: encodeFirestoreValue(Boolean(prev.driveWorkspaceLinked)),
                promptTokens: encodeFirestoreValue(Number(prev.promptTokens || 0) + pAdd),
                outputTokens: encodeFirestoreValue(Number(prev.outputTokens || 0) + oAdd),
                totalTokensUsed: encodeFirestoreValue(Number(prev.totalTokensUsed || 0) + tAdd),
                createdAt: { timestampValue: prev.createdAt || new Date().toISOString() },
              },
            },
            updateMask: {
              fieldPaths: ["applicationCount", "promptTokens", "outputTokens", "totalTokensUsed"],
            },
            updateTransforms: [
              { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
            ],
          },
        ],
      }),
    });
  } catch {
    // Non-fatal stats update
  }
}

async function exportDriveDocPdfBase64(googleDocId, isRawPdf) {
  const gToken = session?.googleAccessToken;
  if (!gToken) {
    throw new Error("Google Drive session expired. Re-open CareerJogger and click Connect Extension to refresh PDF export.");
  }
  const url = isRawPdf
    ? "https://www.googleapis.com/drive/v3/files/" + googleDocId + "?alt=media"
    : "https://www.googleapis.com/drive/v3/files/" + googleDocId + "/export?mimeType=application/pdf";
  const res = await fetch(url, { headers: { Authorization: "Bearer " + gToken } });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Google Drive token expired (401). Sign in on CareerJogger and click Connect Extension.");
    }
    throw new Error("Drive PDF export failed (" + res.status + ").");
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function downloadBase64Pdf(base64Data, fileName) {
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "CareerJogger-CV.pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function findMatchingApp(url) {
  if (!url) return null;
  const cleanUrl = url.split("?")[0].toLowerCase();
  const exact = apps.find(a => a.url && cleanUrl.includes(a.url.split("?")[0].toLowerCase()));
  if (exact) return exact;
  const host = getHostname(url).toLowerCase();
  if (!host) return null;
  return apps.find(a => a.company && host.includes(a.company.toLowerCase().replace(/\\s+/g, ""))) || null;
}

function renderFacts(filter = "") {
  const listEl = document.getElementById("factsList");
  const q = filter.trim().toLowerCase();
  const filtered = facts.filter(f =>
    !q ||
    (f.title || "").toLowerCase().includes(q) ||
    (f.detail || "").toLowerCase().includes(q) ||
    (f.category || "").toLowerCase().includes(q) ||
    (f.metrics || "").toLowerCase().includes(q)
  );
  listEl.innerHTML = "";
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="status-line">No facts loaded yet. Upload your Master CV on CareerJogger and click Sync.</div>';
    return;
  }
  filtered.slice(0, 40).forEach(f => {
    const div = document.createElement("div");
    div.className = "item";
    const textToCopy = [f.title, f.detail, f.metrics].filter(Boolean).join(" — ");
    div.innerHTML = '<div class="item-meta"></div><div class="item-title"></div><div class="item-body"></div><div class="item-actions"><button class="btn-sm copy-btn">Copy Fact</button></div>';
    div.querySelector(".item-meta").textContent = (f.category || "Fact") + (f.sourceFileName ? " · " + f.sourceFileName : "");
    div.querySelector(".item-title").textContent = f.title || "";
    div.querySelector(".item-body").textContent = f.detail + (f.metrics ? " (" + f.metrics + ")" : "");
    div.querySelector(".copy-btn").addEventListener("click", async () => {
      await navigator.clipboard.writeText(textToCopy);
      div.querySelector(".copy-btn").textContent = "Copied";
      setTimeout(() => (div.querySelector(".copy-btn").textContent = "Copy Fact"), 1200);
    });
    listEl.appendChild(div);
  });
}

async function scanActiveTab() {
  const statusEl = document.getElementById("fillStatus");
  const fieldsEl = document.getElementById("detectedFields");
  const reminderEl = document.getElementById("fileReminder");
  fieldsEl.innerHTML = "";
  reminderEl.innerHTML = "";
  reminderEl.classList.add("hidden");

  if (!activeTabId) return;
  try {
    const resp = await chrome.tabs.sendMessage(activeTabId, { type: "CJ_SCAN" });
    lastScan = resp;
    if (!resp) {
      statusEl.textContent = "Reload the job application tab once so CareerJogger can read the form.";
      return;
    }
    const longQuestions = resp.fields.filter(f => f.isLongForm);
    statusEl.textContent = "Detected " + resp.fields.length + " input(s), " + longQuestions.length + " custom question(s).";

    if (resp.fileInputs && resp.fileInputs.length > 0) {
      const header = document.createElement("div");
      header.className = "item-title";
      header.textContent = "CV / Cover Letter Upload Slot (" + resp.fileInputs.length + ")";
      reminderEl.appendChild(header);

      const attachButtonsRow = document.createElement("div");
      attachButtonsRow.className = "item-actions";
      attachButtonsRow.style.marginTop = "6px";

      if (masterCv && (masterCv.googleDocId || masterCv.driveFileId)) {
        const masterBtn = document.createElement("button");
        masterBtn.className = "btn-sm";
        masterBtn.textContent = "Attach Master CV PDF";
        masterBtn.addEventListener("click", async () => {
          masterBtn.textContent = "Exporting PDF...";
          try {
            const targetSlot = resp.fileInputs.find(fi => /cv|resume/i.test(fi.label)) || resp.fileInputs[0];
            const isDoc = Boolean(masterCv.googleDocId);
            const idToFetch = isDoc ? masterCv.googleDocId : masterCv.driveFileId;
            const isRawPdf = !isDoc && /pdf/i.test(masterCv.mimeType || masterCv.fileName || "");
            const b64 = await exportDriveDocPdfBase64(idToFetch, isRawPdf);
            const attachRes = await chrome.tabs.sendMessage(activeTabId, {
              type: "CJ_ATTACH_FILE",
              fileIndex: targetSlot.index,
              fileName: (profile.fullName || "Master_CV").replace(/\\s+/g, "_") + ".pdf",
              base64Data: b64,
              mimeType: "application/pdf",
            });
            if (attachRes && attachRes.ok) {
              masterBtn.textContent = "Attached!";
              statusEl.textContent = "Attached Master CV PDF to " + targetSlot.label;
            } else {
              downloadBase64Pdf(b64, "Master_CV.pdf");
              masterBtn.textContent = "Downloaded PDF";
            }
          } catch (err) {
            masterBtn.textContent = "Attach Master CV PDF";
            statusEl.textContent = err.message;
          }
        });
        attachButtonsRow.appendChild(masterBtn);
      }

      docs.filter(d => d.googleDocId).slice(0, 4).forEach(d => {
        const docBtn = document.createElement("button");
        docBtn.className = "btn-sm";
        docBtn.textContent = "Attach " + (d.docType === "cv" ? "CV" : "Cover") + ": " + d.company;
        docBtn.addEventListener("click", async () => {
          docBtn.textContent = "Exporting...";
          try {
            const targetSlot = d.docType === "coverLetter"
              ? resp.fileInputs.find(fi => /cover/i.test(fi.label)) || resp.fileInputs[0]
              : resp.fileInputs.find(fi => /cv|resume/i.test(fi.label)) || resp.fileInputs[0];
            const b64 = await exportDriveDocPdfBase64(d.googleDocId, false);
            const res = await chrome.tabs.sendMessage(activeTabId, {
              type: "CJ_ATTACH_FILE",
              fileIndex: targetSlot.index,
              fileName: d.pdfFileName || "Document.pdf",
              base64Data: b64,
              mimeType: "application/pdf",
            });
            if (res && res.ok) {
              docBtn.textContent = "Attached!";
              statusEl.textContent = "Attached " + (d.pdfFileName || d.title);
            } else {
              downloadBase64Pdf(b64, d.pdfFileName || "Document.pdf");
              docBtn.textContent = "Downloaded PDF";
            }
          } catch (err) {
            docBtn.textContent = "Attach " + d.company;
            statusEl.textContent = err.message;
          }
        });
        attachButtonsRow.appendChild(docBtn);
      });

      if (attachButtonsRow.children.length === 0) {
        const hint = document.createElement("div");
        hint.className = "item-meta";
        hint.textContent = "Upload your Master CV in CareerJogger (connected to Google Drive) to attach PDFs here in 1 click.";
        reminderEl.appendChild(hint);
      } else {
        reminderEl.appendChild(attachButtonsRow);
      }
      reminderEl.classList.remove("hidden");
    }

    longQuestions.forEach(q => {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = '<div class="item-title"></div><div class="item-actions">' +
        '<button class="btn-sm ai-btn">Draft Answer</button>' +
        '<button class="btn-sm paste-btn">Fill Slot for Review</button></div>' +
        '<textarea class="textarea draft-box" data-cj-qindex="' + q.index + '" rows="3" placeholder="Draft answer will appear here..."></textarea>';
      item.querySelector(".item-title").textContent = q.label;

      const draftBox = item.querySelector(".draft-box");
      if (q.value) draftBox.value = q.value;

      item.querySelector(".ai-btn").addEventListener("click", async () => {
        const btn = item.querySelector(".ai-btn");
        btn.textContent = "Drafting...";
        btn.disabled = true;
        try {
          const base = session?.apiBaseUrl || config.apiBaseUrl;
          const idToken = await ensureFreshIdToken();
          const matched = findMatchingApp(activeUrl);
          const apiRes = await fetch(base + "/api/ai/draft-answers", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(idToken ? { Authorization: "Bearer " + idToken } : {}),
            },
            body: JSON.stringify({
              application: matched || { siteLink: activeUrl, role: activeTitle },
              questions: [{ id: String(q.index), question: q.label }],
              facts: facts.slice(0, 40),
              profile,
            }),
          });
          const data = await apiRes.json();
          if (data.drafts && data.drafts[0]) {
            draftBox.value = data.drafts[0].answer;
            await chrome.tabs.sendMessage(activeTabId, {
              type: "CJ_FILL_FIELD",
              index: q.index,
              value: data.drafts[0].answer,
            });
            if (data.usage) {
              sessionTokensUsed += Number(data.usage.totalTokenCount || 0);
              await incrementStatsInFirestore(0, data.usage);
            }
          } else if (data.error) {
            draftBox.value = "Error: " + data.error;
          }
        } catch (err) {
          draftBox.value = "Server error: " + err.message;
        } finally {
          btn.textContent = "Draft Answer";
          btn.disabled = false;
        }
      });

      item.querySelector(".paste-btn").addEventListener("click", async () => {
        await chrome.tabs.sendMessage(activeTabId, {
          type: "CJ_FILL_FIELD",
          index: q.index,
          value: draftBox.value,
          scroll: true,
        });
      });

      fieldsEl.appendChild(item);
    });
  } catch {
    statusEl.textContent = "Reload the job application tab once so CareerJogger can inspect the form.";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  config = await loadJson("data/config.json");
  profile = await loadJson("data/profile.json");
  facts = await loadJson("data/facts.json");
  apps = await loadJson("data/apps.json");
  docs = await loadJson("data/documents.json");

  const stored = await chrome.storage.local.get(["cj_session", "cj_cached_workspace"]);
  if (stored.cj_session) {
    session = stored.cj_session;
  } else {
    document.getElementById("connectPrompt").classList.remove("hidden");
    document.getElementById("syncBadge").textContent = "Account not connected";
  }

  if (stored.cj_cached_workspace) {
    const cw = stored.cj_cached_workspace;
    if (cw.profile) profile = cw.profile;
    if (cw.facts) facts = cw.facts;
    if (cw.apps) apps = cw.apps;
    if (cw.docs) docs = cw.docs;
    if (cw.masterCv) masterCv = cw.masterCv;
    if (cw.workspaceConfig) workspaceConfig = cw.workspaceConfig;
    if (cw.sheetConfig) sheetConfig = cw.sheetConfig;
  }

  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id || null;
  activeUrl = tab?.url || "";
  activeTitle = tab?.title || "";

  const host = getHostname(activeUrl);
  document.getElementById("logCompany").value = host ? host.split(".")[0] : "";
  document.getElementById("logRole").value = activeTitle.slice(0, 120);

  if (session) {
    await syncFromCloud();
  }

  document.getElementById("syncAccountBtn").addEventListener("click", async () => {
    await syncFromCloud();
    renderFacts(document.getElementById("factSearch").value);
    await scanActiveTab();
  });

  document.getElementById("connectKeyBtn").addEventListener("click", async () => {
    const raw = document.getElementById("connectKeyInput").value.trim();
    if (!raw) return;
    try {
      const decoded = JSON.parse(atob(raw));
      session = decoded;
      await chrome.storage.local.set({ cj_session: session });
      await syncFromCloud();
      renderFacts();
      await scanActiveTab();
    } catch {
      document.getElementById("syncBadge").textContent = "Invalid Connection Key";
    }
  });

  document.getElementById("autofillBtn").addEventListener("click", async () => {
    if (!activeTabId) return;
    const res = await chrome.tabs.sendMessage(activeTabId, {
      type: "CJ_AUTOFILL_STANDARD",
      profile,
    });
    document.getElementById("fillStatus").textContent =
      "Auto-filled " + (res?.filledCount || 0) + " standard profile field(s).";
  });

  document.getElementById("draftAllBtn").addEventListener("click", async () => {
    if (!lastScan || !activeTabId) return;
    const longQs = (lastScan.fields || []).filter(f => f.isLongForm);
    if (longQs.length === 0) {
      document.getElementById("fillStatus").textContent = "No custom application questions detected on this page.";
      return;
    }
    const btn = document.getElementById("draftAllBtn");
    btn.disabled = true;
    btn.textContent = "Drafting " + longQs.length + "...";
    try {
      const base = session?.apiBaseUrl || config.apiBaseUrl;
      const idToken = await ensureFreshIdToken();
      const matched = findMatchingApp(activeUrl);
      const apiRes = await fetch(base + "/api/ai/draft-answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: "Bearer " + idToken } : {}),
        },
        body: JSON.stringify({
          application: matched || { siteLink: activeUrl, role: activeTitle },
          questions: longQs.map(q => ({ id: String(q.index), question: q.label })),
          facts: facts.slice(0, 40),
          profile,
        }),
      });
      const data = await apiRes.json();
      if (!apiRes.ok) throw new Error(data.error || "Drafting failed");
      let filled = 0;
      for (const d of data.drafts || []) {
        const box = document.querySelector('[data-cj-qindex="' + d.questionId + '"]');
        if (box) box.value = d.answer;
        await chrome.tabs.sendMessage(activeTabId, {
          type: "CJ_FILL_FIELD",
          index: Number(d.questionId),
          value: d.answer,
        });
        filled++;
      }
      if (data.usage) {
        sessionTokensUsed += Number(data.usage.totalTokenCount || 0);
        await incrementStatsInFirestore(0, data.usage);
      }
      document.getElementById("fillStatus").textContent =
        "Drafted & populated " + filled + " question(s) on the page for your review.";
    } catch (err) {
      document.getElementById("fillStatus").textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Draft & Fill Questions";
    }
  });

  document.getElementById("logSubmitBtn").addEventListener("click", async () => {
    const company = document.getElementById("logCompany").value.trim() || "Company";
    const role = document.getElementById("logRole").value.trim() || "Application";
    const notes = document.getElementById("logNotes").value.trim();
    const statusEl = document.getElementById("logStatus");
    if (!session || !session.uid) {
      statusEl.textContent = "Connect your CareerJogger account first.";
      return;
    }
    statusEl.textContent = "Saving to CareerJogger & Google Sheet...";
    try {
      const base = getFirestoreBase();
      const token = await ensureFreshIdToken();
      const appId = "ext_" + Date.now();
      const today = new Date().toISOString().slice(0, 10);
      const dbRoot = base.replace(/\\/documents$/, "");
      const docPath = base.replace("https://firestore.googleapis.com/v1/", "") + "/users/" + session.uid + "/applications/" + appId;

      await fetch(dbRoot + "/documents:commit", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          writes: [
            {
              update: {
                name: docPath,
                fields: {
                  id: encodeFirestoreValue(appId),
                  ownerId: encodeFirestoreValue(session.uid),
                  company: encodeFirestoreValue(company),
                  role: encodeFirestoreValue(role),
                  location: encodeFirestoreValue(""),
                  siteLink: encodeFirestoreValue(activeUrl),
                  status: encodeFirestoreValue("Submitted"),
                  cvVersion: encodeFirestoreValue(masterCv?.fileName || "Master CV"),
                  notes: encodeFirestoreValue(notes),
                  deadline: encodeFirestoreValue(""),
                  submissionDate: encodeFirestoreValue(today),
                  companyProfile: encodeFirestoreValue(""),
                  source: encodeFirestoreValue("Chrome Extension"),
                  otherLinks: encodeFirestoreValue(""),
                  interviewPrep: encodeFirestoreValue(""),
                  matchScore: encodeFirestoreValue(0),
                  tokensUsed: encodeFirestoreValue(sessionTokensUsed),
                  cvDocId: encodeFirestoreValue(""),
                  cvDocUrl: encodeFirestoreValue(""),
                  coverDocId: encodeFirestoreValue(""),
                  coverDocUrl: encodeFirestoreValue(""),
                  savedQAs: encodeFirestoreValue([]),
                },
              },
              updateTransforms: [
                { fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" },
                { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" },
              ],
            },
          ],
        }),
      });

      await incrementStatsInFirestore(1, null);

      // Also append to user's Google Sheet tracker if active Drive token is present
      if (sheetConfig?.spreadsheetId && session.googleAccessToken) {
        const tab = sheetConfig.logTab || "Applications Log";
        await fetch(
          "https://sheets.googleapis.com/v4/spreadsheets/" + sheetConfig.spreadsheetId +
          "/values/'" + encodeURIComponent(tab) + "'!A1:append?valueInputOption=USER_ENTERED",
          {
            method: "POST",
            headers: {
              Authorization: "Bearer " + session.googleAccessToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              values: [[role, company, "", activeUrl, "", today, "Submitted", notes, "", "Chrome Extension", "", ""]],
            }),
          }
        );
      }

      statusEl.textContent = "Logged " + company + " — " + role + " to your tracker!";
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  document.getElementById("rescanBtn").addEventListener("click", scanActiveTab);
  document.getElementById("factSearch").addEventListener("input", (e) => renderFacts(e.target.value));

  renderFacts();
  await scanActiveTab();
});`;

  const readme = `CareerJogger — Install-Once Chrome Extension Companion (v2.0)
===============================================================

How to Install Once:
1. Unzip this folder somewhere permanent (e.g., ~/Documents/CareerJogger-Extension).
2. Open chrome://extensions in Chrome, Brave, Arc, or Edge.
3. Turn ON "Developer mode" in the top-right corner.
4. Click "Load unpacked" and select the unzipped folder.
5. Sign in to CareerJogger, click "Connect Extension" once, and your Master CV, Drive PDFs, and Tracker Sheet sync automatically!
`;

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("content.js", contentScript);
  zip.file("popup.html", popupHtml);
  zip.file("popup.css", popupCss);
  zip.file("popup.js", popupJs);
  zip.file("README.txt", readme);
  zip.file("data/config.json", JSON.stringify(configJson, null, 2));
  zip.file("data/profile.json", JSON.stringify(opts.profile, null, 2));
  zip.file("data/facts.json", JSON.stringify(opts.facts, null, 2));
  zip.file("data/apps.json", JSON.stringify(appsIndex, null, 2));
  zip.file("data/documents.json", JSON.stringify(opts.documents || [], null, 2));

  return zip.generateAsync({ type: "blob" });
}
