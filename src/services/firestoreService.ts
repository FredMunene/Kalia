import { User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { auth, db } from "./googleAuth";
import {
  ApplicationLogEntry,
  DriveWorkspaceConfig,
  FactItem,
  GeneratedDocumentEntry,
  MasterCvMetadata,
  ProfileDefaults,
  SheetSyncConfig,
  UserStatsEntry,
} from "../types/career";

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const EMPTY_PROFILE: ProfileDefaults = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  headline: "",
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  xUrl: "",
  workAuth: "",
  yearsExperience: "",
};

function sanitizeDocId(raw: string, fallbackPrefix = "item"): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : `${fallbackPrefix}_${Date.now()}`;
}

function clampString(val: string | undefined, maxLen: number): string {
  if (!val) return "";
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

function sanitizeProfile(p: ProfileDefaults): ProfileDefaults {
  return {
    fullName: clampString(p.fullName, 200),
    email: clampString(p.email, 320),
    phone: clampString(p.phone, 64),
    location: clampString(p.location, 200),
    headline: clampString(p.headline, 500),
    linkedinUrl: clampString(p.linkedinUrl, 500),
    githubUrl: clampString(p.githubUrl, 500),
    portfolioUrl: clampString(p.portfolioUrl, 500),
    xUrl: clampString(p.xUrl, 500),
    workAuth: clampString(p.workAuth, 200),
    yearsExperience: clampString(p.yearsExperience, 64),
  };
}

export interface UserWorkspaceDocData {
  uid: string;
  email: string;
  displayName: string;
  profile: ProfileDefaults;
  workspaceConfig?: DriveWorkspaceConfig;
  sheetConfig?: SheetSyncConfig;
  masterCv?: MasterCvMetadata;
  extensionConnectedAt?: string;
}

export async function ensureUserWorkspaceDoc(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const statsPath = `userStats/${user.uid}`;

  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: clampString(user.email || "", 320),
        displayName: clampString(user.displayName || user.email || "Applicant", 200),
        profile: sanitizeProfile({
          ...EMPTY_PROFILE,
          fullName: user.displayName || "",
          email: user.email || "",
        }),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  try {
    const statsRef = doc(db, "userStats", user.uid);
    const statsSnap = await getDoc(statsRef);
    if (!statsSnap.exists()) {
      await setDoc(statsRef, {
        uid: user.uid,
        email: clampString(user.email || "", 320),
        displayName: clampString(user.displayName || user.email || "Applicant", 200),
        applicationCount: 0,
        masterCvUploaded: false,
        driveWorkspaceLinked: false,
        promptTokens: 0,
        outputTokens: 0,
        totalTokensUsed: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, statsPath);
  }
}

export async function updateUserWorkspaceFields(
  uid: string,
  patch: Partial<{
    displayName: string;
    email: string;
    profile: ProfileDefaults;
    workspaceConfig: DriveWorkspaceConfig;
    sheetConfig: SheetSyncConfig;
    masterCv: MasterCvMetadata;
    extensionConnectedAt: string;
  }>
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch.displayName !== undefined) payload.displayName = clampString(patch.displayName, 200);
    if (patch.email !== undefined) payload.email = clampString(patch.email, 320);
    if (patch.profile !== undefined) payload.profile = sanitizeProfile(patch.profile);
    if (patch.workspaceConfig !== undefined) payload.workspaceConfig = patch.workspaceConfig;
    if (patch.sheetConfig !== undefined) payload.sheetConfig = patch.sheetConfig;
    if (patch.masterCv !== undefined) {
      payload.masterCv = {
        fileName: clampString(patch.masterCv.fileName, 256),
        mimeType: clampString(patch.masterCv.mimeType, 128),
        googleDocId: clampString(patch.masterCv.googleDocId, 256),
        googleDocUrl: clampString(patch.masterCv.googleDocUrl, 1000),
        driveFileId: clampString(patch.masterCv.driveFileId, 256),
        driveFileUrl: clampString(patch.masterCv.driveFileUrl, 1000),
        factsFileId: clampString(patch.masterCv.factsFileId, 256),
        rawTextPreview: clampString(patch.masterCv.rawTextPreview, 19500),
        updatedAt: clampString(patch.masterCv.updatedAt, 64),
      };
    }
    if (patch.extensionConnectedAt !== undefined) {
      payload.extensionConnectedAt = clampString(patch.extensionConnectedAt, 64);
    }
    await updateDoc(doc(db, "users", uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertFactDoc(uid: string, fact: FactItem): Promise<FactItem> {
  const safeId = sanitizeDocId(fact.id, "fact");
  const path = `users/${uid}/facts/${safeId}`;
  const normalized: FactItem = {
    ...fact,
    id: safeId,
    title: clampString(fact.title.trim() || "Career Fact", 240),
    detail: clampString(fact.detail, 4000),
    metrics: clampString(fact.metrics, 500),
    sourceFileId: clampString(fact.sourceFileId, 256),
    sourceFileName: clampString(fact.sourceFileName, 256),
    updatedAt: fact.updatedAt || new Date().toISOString(),
  };

  try {
    const ref = doc(db, "users", uid, "facts", safeId);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        category: normalized.category,
        title: normalized.title,
        detail: normalized.detail,
        metrics: normalized.metrics || "",
        sourceFileId: normalized.sourceFileId || "",
        sourceFileName: normalized.sourceFileName || "",
        verified: Boolean(normalized.verified),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: safeId,
        ownerId: uid,
        category: normalized.category,
        title: normalized.title,
        detail: normalized.detail,
        metrics: normalized.metrics || "",
        sourceFileId: normalized.sourceFileId || "",
        sourceFileName: normalized.sourceFileName || "",
        verified: Boolean(normalized.verified),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return normalized;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function batchCreateFactDocs(uid: string, facts: FactItem[]): Promise<FactItem[]> {
  const path = `users/${uid}/facts`;
  if (facts.length === 0) return [];
  try {
    const batch = writeBatch(db);
    const saved: FactItem[] = [];
    for (const f of facts.slice(0, 100)) {
      const safeId = sanitizeDocId(f.id, "fact");
      const normalized: FactItem = {
        ...f,
        id: safeId,
        title: clampString(f.title.trim() || "Career Fact", 240),
        detail: clampString(f.detail, 4000),
        metrics: clampString(f.metrics, 500),
        sourceFileId: clampString(f.sourceFileId, 256),
        sourceFileName: clampString(f.sourceFileName, 256),
        updatedAt: f.updatedAt || new Date().toISOString(),
      };
      const ref = doc(db, "users", uid, "facts", safeId);
      batch.set(ref, {
        id: safeId,
        ownerId: uid,
        category: normalized.category,
        title: normalized.title,
        detail: normalized.detail,
        metrics: normalized.metrics || "",
        sourceFileId: normalized.sourceFileId || "",
        sourceFileName: normalized.sourceFileName || "",
        verified: Boolean(normalized.verified),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      saved.push(normalized);
    }
    await batch.commit();
    return saved;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFactDoc(uid: string, factId: string): Promise<void> {
  const safeId = sanitizeDocId(factId, "fact");
  const path = `users/${uid}/facts/${safeId}`;
  try {
    await deleteDoc(doc(db, "users", uid, "facts", safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertApplicationDoc(
  uid: string,
  entry: ApplicationLogEntry
): Promise<{ entry: ApplicationLogEntry; isNew: boolean }> {
  const safeId = sanitizeDocId(entry.id, "app");
  const path = `users/${uid}/applications/${safeId}`;
  const normalizedQAs = (entry.savedQAs || []).slice(0, 30).map((qa) => ({
    id: sanitizeDocId(qa.id, "qa"),
    question: clampString(qa.question, 1000),
    answer: clampString(qa.answer, 8000),
    citedFactIds: (qa.citedFactIds || []).slice(0, 20),
    updatedAt: clampString(qa.updatedAt || new Date().toISOString(), 64),
  }));

  const fields = {
    company: clampString(entry.company, 200),
    role: clampString(entry.role, 200),
    location: clampString(entry.location, 200),
    siteLink: clampString(entry.siteLink, 1000),
    status: clampString(entry.status || "Not Applied", 64),
    cvVersion: clampString(entry.cvVersion, 200),
    notes: clampString(entry.notes, 4000),
    deadline: clampString(entry.deadline, 64),
    submissionDate: clampString(entry.submissionDate, 64),
    companyProfile: clampString(entry.companyProfile, 2000),
    source: clampString(entry.source, 200),
    otherLinks: clampString(entry.otherLinks, 1000),
    interviewPrep: clampString(entry.interviewPrep, 4000),
    matchScore: Math.max(0, Math.min(100, Number(entry.matchScore || 0))),
    tokensUsed: Math.max(0, Number(entry.tokensUsed || 0)),
    cvDocId: clampString(entry.cvDocId, 256),
    cvDocUrl: clampString(entry.cvDocUrl, 1000),
    coverDocId: clampString(entry.coverDocId, 256),
    coverDocUrl: clampString(entry.coverDocUrl, 1000),
    savedQAs: normalizedQAs,
  };

  try {
    const ref = doc(db, "users", uid, "applications", safeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        ...fields,
        updatedAt: serverTimestamp(),
      });
      return { entry: { ...entry, id: safeId, savedQAs: normalizedQAs }, isNew: false };
    } else {
      await setDoc(ref, {
        id: safeId,
        ownerId: uid,
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { entry: { ...entry, id: safeId, savedQAs: normalizedQAs }, isNew: true };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteApplicationDoc(uid: string, appId: string): Promise<void> {
  const safeId = sanitizeDocId(appId, "app");
  const path = `users/${uid}/applications/${safeId}`;
  try {
    await deleteDoc(doc(db, "users", uid, "applications", safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertGeneratedDocRecord(
  uid: string,
  docEntry: GeneratedDocumentEntry
): Promise<void> {
  const safeId = sanitizeDocId(docEntry.id, "doc");
  const path = `users/${uid}/generatedDocs/${safeId}`;
  const fields = {
    roleId: clampString(docEntry.roleId, 128),
    company: clampString(docEntry.company, 200),
    role: clampString(docEntry.role, 200),
    title: clampString(docEntry.title, 240),
    googleDocId: clampString(docEntry.googleDocId, 256),
    googleDocUrl: clampString(docEntry.googleDocUrl, 1000),
    pdfFileName: clampString(docEntry.pdfFileName, 256),
  };

  try {
    const ref = doc(db, "users", uid, "generatedDocs", safeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        ...fields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: safeId,
        ownerId: uid,
        docType: docEntry.docType,
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteGeneratedDocRecord(uid: string, docId: string): Promise<void> {
  const safeId = sanitizeDocId(docId, "doc");
  const path = `users/${uid}/generatedDocs/${safeId}`;
  try {
    await deleteDoc(doc(db, "users", uid, "generatedDocs", safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function recordUserStatsDelta(
  uid: string,
  delta: {
    email?: string;
    displayName?: string;
    applicationIncrement?: number;
    applicationCountAbsolute?: number;
    promptTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    masterCvUploaded?: boolean;
    driveWorkspaceLinked?: boolean;
  }
): Promise<void> {
  const path = `userStats/${uid}`;
  const ref = doc(db, "userStats", uid);
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const addPrompt = Math.max(0, Number(delta.promptTokens || 0));
      const addOutput = Math.max(0, Number(delta.outputTokens || 0));
      const addTotal = Math.max(0, Number(delta.totalTokens || addPrompt + addOutput));

      if (!snap.exists()) {
        const initCount =
          delta.applicationCountAbsolute !== undefined
            ? Math.max(0, delta.applicationCountAbsolute)
            : Math.max(0, Number(delta.applicationIncrement || 0));
        tx.set(ref, {
          uid,
          email: clampString(delta.email || auth.currentUser?.email || "", 320),
          displayName: clampString(
            delta.displayName || auth.currentUser?.displayName || "Applicant",
            200
          ),
          applicationCount: initCount,
          masterCvUploaded: Boolean(delta.masterCvUploaded),
          driveWorkspaceLinked: Boolean(delta.driveWorkspaceLinked),
          promptTokens: addPrompt,
          outputTokens: addOutput,
          totalTokensUsed: addTotal,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      }

      const prev = snap.data();
      const nextAppCount =
        delta.applicationCountAbsolute !== undefined
          ? Math.max(0, delta.applicationCountAbsolute)
          : Math.max(0, Number(prev.applicationCount || 0) + Number(delta.applicationIncrement || 0));

      tx.update(ref, {
        email: clampString(delta.email || prev.email || "", 320),
        displayName: clampString(delta.displayName || prev.displayName || "Applicant", 200),
        applicationCount: nextAppCount,
        masterCvUploaded:
          delta.masterCvUploaded !== undefined
            ? delta.masterCvUploaded
            : Boolean(prev.masterCvUploaded),
        driveWorkspaceLinked:
          delta.driveWorkspaceLinked !== undefined
            ? delta.driveWorkspaceLinked
            : Boolean(prev.driveWorkspaceLinked),
        promptTokens: Number(prev.promptTokens || 0) + addPrompt,
        outputTokens: Number(prev.outputTokens || 0) + addOutput,
        totalTokensUsed: Number(prev.totalTokensUsed || 0) + addTotal,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToUserWorkspace(
  uid: string,
  callbacks: {
    onWorkspace: (data: UserWorkspaceDocData | null) => void;
    onFacts: (facts: FactItem[]) => void;
    onApplications: (apps: ApplicationLogEntry[]) => void;
    onGeneratedDocs: (docs: GeneratedDocumentEntry[]) => void;
  }
): () => void {
  const userPath = `users/${uid}`;
  const factsPath = `users/${uid}/facts`;
  const appsPath = `users/${uid}/applications`;
  const docsPath = `users/${uid}/generatedDocs`;

  const unsubUser = onSnapshot(
    doc(db, "users", uid),
    (snap) => {
      if (!snap.exists()) {
        callbacks.onWorkspace(null);
        return;
      }
      const d = snap.data();
      callbacks.onWorkspace({
        uid: d.uid,
        email: d.email || "",
        displayName: d.displayName || "",
        profile: { ...EMPTY_PROFILE, ...(d.profile || {}) },
        workspaceConfig: d.workspaceConfig,
        sheetConfig: d.sheetConfig,
        masterCv: d.masterCv,
        extensionConnectedAt: d.extensionConnectedAt,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, userPath);
    }
  );

  const factsQuery = query(
    collection(db, "users", uid, "facts"),
    where("ownerId", "==", uid)
  );
  const unsubFacts = onSnapshot(
    factsQuery,
    (snap) => {
      const items: FactItem[] = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.updatedAt as Timestamp | undefined;
        return {
          id: data.id || d.id,
          category: data.category,
          title: data.title || "",
          detail: data.detail || "",
          metrics: data.metrics || "",
          sourceFileId: data.sourceFileId || "",
          sourceFileName: data.sourceFileName || "",
          verified: Boolean(data.verified),
          updatedAt: ts?.toDate ? ts.toDate().toISOString() : new Date().toISOString(),
        };
      });
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      callbacks.onFacts(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, factsPath);
    }
  );

  const appsQuery = query(
    collection(db, "users", uid, "applications"),
    where("ownerId", "==", uid)
  );
  const unsubApps = onSnapshot(
    appsQuery,
    (snap) => {
      const items: ApplicationLogEntry[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: data.id || d.id,
          company: data.company || "",
          role: data.role || "",
          location: data.location || "",
          siteLink: data.siteLink || "",
          status: data.status || "Not Applied",
          cvVersion: data.cvVersion || "",
          notes: data.notes || "",
          deadline: data.deadline || "",
          submissionDate: data.submissionDate || "",
          companyProfile: data.companyProfile || "",
          source: data.source || "",
          otherLinks: data.otherLinks || "",
          interviewPrep: data.interviewPrep || "",
          matchScore: Number(data.matchScore || 0),
          tokensUsed: Number(data.tokensUsed || 0),
          cvDocId: data.cvDocId || "",
          cvDocUrl: data.cvDocUrl || "",
          coverDocId: data.coverDocId || "",
          coverDocUrl: data.coverDocUrl || "",
          savedQAs: Array.isArray(data.savedQAs) ? data.savedQAs : [],
        };
      });
      callbacks.onApplications(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, appsPath);
    }
  );

  const docsQuery = query(
    collection(db, "users", uid, "generatedDocs"),
    where("ownerId", "==", uid)
  );
  const unsubDocs = onSnapshot(
    docsQuery,
    (snap) => {
      const items: GeneratedDocumentEntry[] = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.updatedAt as Timestamp | undefined;
        return {
          id: data.id || d.id,
          docType: data.docType,
          roleId: data.roleId || undefined,
          company: data.company || "",
          role: data.role || "",
          title: data.title || "",
          googleDocId: data.googleDocId || "",
          googleDocUrl: data.googleDocUrl || "",
          pdfFileName: data.pdfFileName || "",
          updatedAt: ts?.toDate ? ts.toDate().toISOString() : new Date().toISOString(),
        };
      });
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      callbacks.onGeneratedDocs(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, docsPath);
    }
  );

  return () => {
    unsubUser();
    unsubFacts();
    unsubApps();
    unsubDocs();
  };
}

export function subscribeToAdminUserStats(
  onData: (rows: UserStatsEntry[]) => void
): () => void {
  const path = "userStats";
  const q = query(collection(db, "userStats"), orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const rows: UserStatsEntry[] = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.updatedAt as Timestamp | undefined;
        return {
          uid: data.uid || d.id,
          email: data.email || "",
          displayName: data.displayName || "",
          applicationCount: Number(data.applicationCount || 0),
          masterCvUploaded: Boolean(data.masterCvUploaded),
          driveWorkspaceLinked: Boolean(data.driveWorkspaceLinked),
          promptTokens: Number(data.promptTokens || 0),
          outputTokens: Number(data.outputTokens || 0),
          totalTokensUsed: Number(data.totalTokensUsed || 0),
          updatedAtIso: ts?.toDate ? ts.toDate().toISOString() : undefined,
        };
      });
      onData(rows);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}
