import React from "react";
import { FolderOpen, FileText, Puzzle, ShieldCheck } from "lucide-react";
import { GoogleSignInButton } from "./GoogleSignInButton";

interface SignInLandingProps {
  onLogin: () => void;
  isLoggingIn: boolean;
  authError: string | null;
}

export const SignInLanding: React.FC<SignInLandingProps> = ({
  onLogin,
  isLoggingIn,
  authError,
}) => {
  return (
    <div className="flex min-h-screen flex-col justify-between bg-white text-slate-900">
      <header className="flex h-14 items-center justify-between border-b border-slate-200 px-6 lg:px-10">
        <div className="font-display text-base font-bold tracking-tight text-slate-900">
          CareerJogger
        </div>
        <div className="text-xs text-slate-500">
          User-Owned Drive Workspace & Extension Autofill
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-12">
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Automated Job Application Workspace
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Upload your Master CV once. Keep every file in your own Google Drive.
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-600">
            When you sign in with Google, CareerJogger automatically sets up a dedicated workspace folder in your Google Drive for your Master CV, verified facts, tailored CV & cover letter PDFs, and Job Tracker Sheet—then syncs live with your browser extension.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <GoogleSignInButton
            onClick={onLogin}
            disabled={isLoggingIn}
            label={isLoggingIn ? "Setting up workspace..." : "Sign in with Google to Start"}
          />
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Files stay inside your own Google Drive & private account
          </span>
        </div>

        {authError && (
          <div className="mt-4 max-w-xl rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
            {authError}
          </div>
        )}

        <div className="mt-12 grid grid-cols-1 gap-5 border-t border-slate-200 pt-8 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <FolderOpen className="h-4 w-4 text-slate-700" />
              1. Personal Drive Workspace
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Automatically creates <span className="font-mono">CareerJogger Workspace</span> in your Drive with subfolders for Source CVs, Tailored CVs, Cover Letters, and your live Job Tracker Google Sheet.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <FileText className="h-4 w-4 text-slate-700" />
              2. Master CV & Fact Vault
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Upload your PDF, DOCX, or TXT Master CV once. CareerJogger extracts verified facts and contact links so every application answer and tailored PDF stays strictly grounded.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <Puzzle className="h-4 w-4 text-slate-700" />
              3. Install-Once Extension
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Connects to your account once, scans job forms, drafts & fills custom questions for review, attaches PDFs from your Drive, and logs submissions to your Sheet.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 px-6 py-4 text-center text-xs text-slate-400">
        CareerJogger · Multi-user Drive-first application assistant
      </footer>
    </div>
  );
};
