import { describe, it, expect } from "vitest";
import {
  parseCsvRows,
  parseJobTrackerCsv,
  serializeApplicationsCsv,
  serializePipelineCsv,
} from "./csvParser";
import { ApplicationLogEntry, TargetPipelineEntry } from "../types/career";

describe("csvParser utility", () => {
  it("parses standard CSV rows correctly with LF and CRLF", () => {
    const csv = 'Role,Company,Location\r\nDeveloper,Stripe,Remote\n"Product Manager","Google","New York"\r\n';
    const rows = parseCsvRows(csv);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]).toEqual(["Role", "Company", "Location"]);
    expect(rows[1]).toEqual(["Developer", "Stripe", "Remote"]);
  });

  it("handles quoted fields with commas, escaped quotes, and single quotes", () => {
    const csv = 'Field1,Field2\n"Hello, World",\"He said ""Hi\""\"';
    const rows = parseCsvRows(csv);
    expect(rows[1][0]).toBe("Hello, World");
    expect(rows[1][1]).toBe('He said "Hi"');
  });

  it("unwraps nested row if needed and parses job tracker CSV", () => {
    const csv = [
      "Role,Company,Location,Site link,Application Deadline,Submission Date,Status,Notes,Company Profile,Source,other links,interview-prep",
      "Software Engineer,Stripe,Remote,https://stripe.com/jobs,2026-06-01,2026-05-01,Submitted,Great team,Fintech,Direct,,",
      "", // empty row test
      "Verification Status,Company,Role,Match Score,Location,Salary,CV Version Used,Application Method,Target Contact / Recruiter,Outreach Status,Next Action Date,NextAction,Application Link,Notes",
      "Ready,OpenAI,AI Researcher,95,San Francisco,$250k,CV_v1,Direct,Recruiter,In Conversation,2026-06-10,Follow up,https://openai.com/jobs,Top priority",
      '"Stripe, Backend, Remote, https://stripe.com, 2026-01-01",,,,,,,,,,,,,', // nested row test
    ].join("\n");

    const result = parseJobTrackerCsv(csv);
    expect(result.applications.length).toBeGreaterThanOrEqual(1);
    expect(result.pipeline.length).toBeGreaterThanOrEqual(1);
  });

  it("serializes application log entries and pipeline entries to CSV correctly", () => {
    const apps: ApplicationLogEntry[] = [
      {
        id: "app-1",
        role: "Frontend Engineer",
        company: "Vercel",
        location: "Remote",
        siteLink: "https://vercel.com/jobs",
        deadline: "2026-07-01",
        submissionDate: "2026-06-15",
        status: "Submitted",
        notes: "Fast workflow, \"great tools\"",
        companyProfile: "Cloud",
        source: "Referral",
        otherLinks: "",
        interviewPrep: "Next.js",
      },
    ];

    const pipeline: TargetPipelineEntry[] = [
      {
        id: "pipe-1",
        verificationStatus: "Verified",
        company: "Anthropic",
        role: "AI Safety Engineer",
        matchScore: 92,
        location: "San Francisco",
        salary: "$300k",
        cvVersion: "CV_AI_v1",
        applicationMethod: "Direct Portal",
        targetContact: "HR",
        outreachStatus: "In Conversation",
        nextActionDate: "2026-06-20",
        nextAction: "Interview",
        applicationLink: "https://anthropic.com/jobs",
        notes: "Exciting research",
      },
    ];

    const appCsv = serializeApplicationsCsv(apps);
    const pipeCsv = serializePipelineCsv(pipeline);
    expect(appCsv).toContain("Frontend Engineer");
    expect(pipeCsv).toContain("Anthropic");
  });
});
