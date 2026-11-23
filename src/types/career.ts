export type ApplicationStatus =
  | "Submitted"
  | "Not Applied"
  | "Redirected"
  | "Missed Deadline"
  | "Interviewing"
  | "In Conversation"
  | "Offer"
  | "Rejected"
  | "";

export interface SavedQA {
  id: string;
  question: string;
  answer: string;
  citedFactIds: string[];
  updatedAt: string;
}

export interface ApplicationLogEntry {
  id: string;
  role: string;
  company: string;
  location: string;
  siteLink: string;
  deadline: string;
  submissionDate: string;
  status: string;
  notes: string;
  companyProfile: string;
  source: string;
  otherLinks: string;
  interviewPrep: string;
  cvVersion?: string;
  matchScore?: number;
  tokensUsed?: number;
  cvDocId?: string;
  cvDocUrl?: string;
  coverDocId?: string;
  coverDocUrl?: string;
  savedQAs?: SavedQA[];
}

export interface TargetPipelineEntry {
  id: string;
  verificationStatus: string;
  company: string;
  role: string;
  matchScore: number;
  location: string;
  salary: string;
  cvVersion: string;
  applicationMethod: string;
  targetContact: string;
  outreachStatus: string;
  nextActionDate: string;
  nextAction: string;
  applicationLink: string;
  notes: string;
  savedQAs?: SavedQA[];
}

export type FactCategory =
  | "Identity & Links"
  | "Experience"
  | "Projects"
  | "Hackathons & Wins"
  | "Speaking & DevRel"
  | "Education & Certs";

export interface FactItem {
  id: string;
  category: FactCategory;
  title: string;
  detail: string;
  metrics?: string;
  sourceFileId?: string;
  sourceFileName?: string;
  verified: boolean;
  updatedAt: string;
}

export interface ProfileDefaults {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  xUrl: string;
  workAuth: string;
  yearsExperience: string;
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  folderName?: string;
}

export interface SheetSyncConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  pipelineTab: string;
  logTab: string;
  lastSyncedAt?: string;
}

export interface DriveWorkspaceConfig {
  rootFolderId: string;
  rootFolderName: string;
  rootFolderUrl: string;
  trackersFolderId: string;
  cvsFolderId: string;
  coverLettersFolderId: string;
  sourcesFolderId: string;
  createdAt: string;
}

export interface MasterCvMetadata {
  fileName: string;
  mimeType: string;
  googleDocId?: string;
  googleDocUrl?: string;
  driveFileId?: string;
  driveFileUrl?: string;
  factsFileId?: string;
  rawTextPreview: string;
  updatedAt: string;
}

export interface TailoredCvDraft {
  title: string;
  headerLine: string;
  contactLine: string;
  summary: string;
  sections: Array<{
    heading: string;
    bullets: string[];
  }>;
}

export interface TailoredCoverLetterDraft {
  title: string;
  recipientLine: string;
  salutation: string;
  paragraphs: string[];
  signOff: string;
}

export interface GeneratedDocumentEntry {
  id: string;
  docType: "cv" | "coverLetter";
  roleId?: string;
  company: string;
  role: string;
  title: string;
  googleDocId?: string;
  googleDocUrl?: string;
  pdfFileName: string;
  pdfBase64?: string;
  updatedAt: string;
}

export interface TokenUsageSummary {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

export interface UserStatsEntry {
  uid: string;
  email: string;
  displayName: string;
  applicationCount: number;
  masterCvUploaded: boolean;
  driveWorkspaceLinked: boolean;
  promptTokens: number;
  outputTokens: number;
  totalTokensUsed: number;
  updatedAtIso?: string;
}

export type WorkspaceView =
  | "master-cv"
  | "applications"
  | "extension"
  | "admin";
