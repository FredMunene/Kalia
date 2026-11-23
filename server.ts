import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { initializeApp as initializeAdminApp, getApps as getAdminApps, getApp as getAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function getFirebaseProjectId(): string | undefined {
  try {
    const configPath = path.resolve(__dirname, "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as { projectId?: string };
      return parsed.projectId;
    }
  } catch {
    // Ignore read errors
  }
  return process.env.GOOGLE_CLOUD_PROJECT || undefined;
}

const adminProjectId = getFirebaseProjectId();
const adminApp = getAdminApps().length
  ? getAdminApp()
  : initializeAdminApp(adminProjectId ? { projectId: adminProjectId } : {});
const adminAuth = getAdminAuth(adminApp);

async function verifyCallerAuth(
  req: express.Request
): Promise<{ uid: string; email?: string }> {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error("AUTH_REQUIRED: Sign in with your Google account to use AI features.");
  }
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    throw new Error("AUTH_INVALID: Session expired. Reconnect your account and try again.");
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please add your key in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function extractUsageSummary(response: {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}) {
  const promptTokenCount = Number(response.usageMetadata?.promptTokenCount || 0);
  const candidatesTokenCount = Number(response.usageMetadata?.candidatesTokenCount || 0);
  const totalTokenCount = Number(
    response.usageMetadata?.totalTokenCount || promptTokenCount + candidatesTokenCount
  );
  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount,
  };
}

function isTransientError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return (
    raw.includes("503") ||
    raw.includes("UNAVAILABLE") ||
    raw.includes("high demand") ||
    raw.includes("429") ||
    raw.includes("RESOURCE_EXHAUSTED") ||
    raw.includes("ECONNRESET") ||
    raw.includes("ETIMEDOUT")
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateWithResilience(
  ai: GoogleGenAI,
  params: {
    contents: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"];
    config: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["config"];
  }
) {
  const delays = [800, 1800];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: params.contents,
        config: params.config,
      });
    } catch (err) {
      lastError = err;
      console.warn(
        `[Gemini] gemini-4-hydrogen attempt ${attempt + 1} failed:`,
        err instanceof Error ? err.message : String(err)
      );
      if (!isTransientError(err) || attempt === delays.length) {
        break;
      }
      await sleep(delays[attempt]);
    }
  }

  // Fallback to gemini-3.1-flash-lite when gemini-4-hydrogen is temporarily unavailable
  if (isTransientError(lastError)) {
    const fallbackConfig = params.config ? { ...params.config } : undefined;
    if (fallbackConfig && "thinkingConfig" in fallbackConfig) {
      delete fallbackConfig.thinkingConfig;
    }
    try {
      return await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: params.contents,
        config: fallbackConfig,
      });
    } catch (fallbackErr) {
      console.warn(
        "[Gemini] gemini-3.1-flash-lite fallback failed:",
        fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      );
      if (isTransientError(fallbackErr)) {
        await sleep(1000);
        return await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: params.contents,
          config: fallbackConfig,
        });
      }
      throw fallbackErr;
    }
  }

  throw lastError;
}

function safeParseModelJson<T = Record<string, unknown>>(rawText: string | undefined): T {
  const trimmed = (rawText ?? "{}").trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const firstBrace = unfenced.indexOf("{");
    const lastBrace = unfenced.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(unfenced.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error("AI response could not be parsed as structured JSON. Please retry.");
  }
}

function getReadableError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith("AUTH_REQUIRED:") || raw.startsWith("AUTH_INVALID:")) {
    return { status: 401, message: raw.replace(/^AUTH_[A-Z]+:\s*/, "") };
  }
  if (raw.includes("GEMINI_API_KEY")) {
    return { status: 400, message: raw };
  }
  if (raw.includes("403") || raw.includes("PERMISSION_DENIED") || raw.includes("API_KEY_INVALID")) {
    return {
      status: 403,
      message: "Gemini API key was rejected. Check Settings > Secrets in AI Studio.",
    };
  }
  if (raw.includes("503") || raw.includes("UNAVAILABLE") || raw.includes("high demand")) {
    // Return HTTP 500 (not 502/503/504) so the reverse proxy passes the JSON error through instead of an HTML waking-up page.
    return {
      status: 500,
      message:
        "Gemini is experiencing a temporary demand spike (503). Automatic retries and Flash Lite fallback were attempted—please wait a few seconds and retry.",
    };
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Gemini API rate limit reached. Please wait a moment and retry.",
    };
  }
  return { status: 500, message: raw || "Server error calling Gemini." };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // Allow the companion Chrome extension to call drafting endpoints
  app.use("/api", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, model: "gemini-4-hydrogen" });
  });

  app.post("/api/ai/extract-facts", async (req, res) => {
    try {
      await verifyCallerAuth(req);
      const { files } = req.body as {
        files: Array<{
          id: string;
          name: string;
          mimeType: string;
          textContent?: string;
          base64Data?: string;
        }>;
      };

      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: "Provide at least one document to extract facts from." });
      }

      const ai = getGeminiClient();

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: [
            "You are a precision career-fact extractor. Read all provided CVs, resumes, project notes, and portfolio documents.",
            "Extract ONLY concrete, verifiable facts explicitly supported by the source files. Do NOT invent metrics, employers, dates, or URLs.",
            "Return JSON matching the schema with:",
            "1. profile: candidate contact and canonical links found in the documents (leave missing fields as empty string).",
            "2. facts: discrete, reusable fact cards categorized strictly as one of: 'Identity & Links', 'Experience', 'Projects', 'Hackathons & Wins', 'Speaking & DevRel', 'Education & Certs'.",
            "Include specific metrics, tech stack, protocol names, and sourceFileId/sourceFileName for every fact.",
          ].join("\n"),
        },
      ];

      for (const file of files) {
        parts.push({
          text: `\n--- SOURCE FILE: ${file.name} (id: ${file.id}, mime: ${file.mimeType}) ---`,
        });
        if (file.base64Data && (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/"))) {
          parts.push({
            inlineData: {
              mimeType: file.mimeType,
              data: file.base64Data,
            },
          });
        } else if (file.textContent) {
          parts.push({
            text: file.textContent.slice(0, 60000),
          });
        } else {
          parts.push({
            text: `[Binary file ${file.name} (${file.mimeType}) — no inline text extracted]`,
          });
        }
      }

      const response = await generateWithResilience(ai, {
        contents: { parts },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              profile: {
                type: Type.OBJECT,
                properties: {
                  fullName: { type: Type.STRING },
                  email: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  location: { type: Type.STRING },
                  headline: { type: Type.STRING },
                  linkedinUrl: { type: Type.STRING },
                  githubUrl: { type: Type.STRING },
                  portfolioUrl: { type: Type.STRING },
                  xUrl: { type: Type.STRING },
                  workAuth: { type: Type.STRING },
                  yearsExperience: { type: Type.STRING },
                },
              },
              facts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    title: { type: Type.STRING },
                    detail: { type: Type.STRING },
                    metrics: { type: Type.STRING },
                    sourceFileId: { type: Type.STRING },
                    sourceFileName: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = safeParseModelJson<Record<string, unknown>>(response.text);
      res.json({
        ...parsed,
        usage: extractUsageSummary(response),
      });
    } catch (err) {
      const { status, message } = getReadableError(err);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/ai/draft-answers", async (req, res) => {
    try {
      await verifyCallerAuth(req);
      const { application, jobDescription, questions, facts, profile } = req.body as {
        application?: {
          company?: string;
          role?: string;
          cvVersion?: string;
          notes?: string;
          location?: string;
          siteLink?: string;
        };
        jobDescription?: string;
        questions: Array<{ id: string; question: string; charLimit?: number }>;
        facts: Array<{
          id: string;
          category: string;
          title: string;
          detail: string;
          metrics?: string;
          sourceFileName?: string;
        }>;
        profile?: Record<string, string>;
      };

      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: "Provide at least one application question to draft." });
      }

      const ai = getGeminiClient();

      const prompt = [
        "You are an expert technical career writer helping a candidate fill out a job application form accurately.",
        "CRITICAL GROUNDING RULE: Base every claim, project, metric, company, hackathon, degree, and link strictly on the Candidate Profile and Fact Vault provided below. NEVER fabricate experience or numbers.",
        "If a question asks for something not covered in the Fact Vault, write the strongest honest framing from existing facts and explicitly list what is missing in `missingFactGap`.",
        "Keep answers natural, concise, direct, and ready to paste into an ATS form (avoid clichés like 'thrilled to apply' or generic buzzwords).",
        "",
        "CANDIDATE PROFILE:",
        JSON.stringify(profile || {}, null, 2),
        "",
        "TARGET APPLICATION CONTEXT:",
        JSON.stringify(application || {}, null, 2),
        "",
        jobDescription ? `JOB DESCRIPTION / PAGE CONTEXT:\n${jobDescription.slice(0, 15000)}\n` : "",
        "VERIFIED FACT VAULT:",
        JSON.stringify(facts || [], null, 2),
        "",
        "APPLICATION QUESTIONS TO ANSWER:",
        JSON.stringify(questions, null, 2),
      ].join("\n");

      const response = await generateWithResilience(ai, {
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recommendedCvVersion: { type: Type.STRING },
              drafts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    questionId: { type: Type.STRING },
                    answer: { type: Type.STRING },
                    citedFactIds: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    missingFactGap: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = safeParseModelJson<Record<string, unknown>>(response.text);
      res.json({
        ...parsed,
        usage: extractUsageSummary(response),
      });
    } catch (err) {
      const { status, message } = getReadableError(err);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/ai/parse-job-url", async (req, res) => {
    try {
      await verifyCallerAuth(req);
      const { url } = req.body as { url?: string };
      if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: "Provide a valid http/https job URL." });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      let html = "";
      try {
        const resp = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; CareerJogger/1.0; +https://careerjogger.local)",
            Accept: "text/html,application/xhtml+xml",
          },
        });
        if (!resp.ok) {
          return res.json({
            ok: false,
            reason: `Portal returned HTTP ${resp.status}. Copy-paste the job text or use the Chrome Extension on the open tab.`,
          });
        }
        html = await resp.text();
      } catch {
        return res.json({
          ok: false,
          reason:
            "This portal blocks automated fetching or timed out. Paste the job text below or use the Chrome Extension directly on the open tab.",
        });
      } finally {
        clearTimeout(timer);
      }

      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 18000);

      if (stripped.length < 120) {
        return res.json({
          ok: false,
          reason:
            "Page rendered dynamically via JavaScript. Use the Chrome Extension on the open tab or paste the description below.",
        });
      }

      const ai = getGeminiClient();
      const response = await generateWithResilience(ai, {
        contents: `Extract structured job details from this web page text (URL: ${url}):\n\n${stripped}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING },
              company: { type: Type.STRING },
              location: { type: Type.STRING },
              deadline: { type: Type.STRING },
              summary: { type: Type.STRING },
              detectedQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      });

      const parsed = safeParseModelJson<Record<string, unknown>>(response.text);
      res.json({
        ok: true,
        ...parsed,
        usage: extractUsageSummary(response),
      });
    } catch (err) {
      const { status, message } = getReadableError(err);
      res.status(status).json({ error: message });
    }
  });

  app.post("/api/ai/generate-documents", async (req, res) => {
    try {
      await verifyCallerAuth(req);
      const { application, jobDescription, facts, profile } = req.body as {
        application?: {
          company?: string;
          role?: string;
          location?: string;
          siteLink?: string;
          notes?: string;
        };
        jobDescription?: string;
        facts: Array<{
          id: string;
          category: string;
          title: string;
          detail: string;
          metrics?: string;
          sourceFileName?: string;
        }>;
        profile?: Record<string, string>;
      };

      if (!application?.company && !application?.role && !jobDescription?.trim()) {
        return res.status(400).json({
          error: "Provide a target company/role or paste a job description first.",
        });
      }

      const ai = getGeminiClient();

      const prompt = [
        "You are an executive technical resume and cover-letter writer.",
        "CRITICAL GROUNDING RULE: Every experience bullet, project, metric, hackathon win, stack, employer, degree, and URL MUST come strictly from the Candidate Profile and Verified Fact Vault below. NEVER invent companies, dates, or numbers.",
        "If key skills from the job description are missing in the Fact Vault, note them honestly in `missingFactGap` instead of fabricating them.",
        "Return structured JSON with:",
        "1. `cvDoc`: a concise, ATS-friendly, impact-driven 1-page CV tailored to the target role (sections like Experience, Selected Projects & Wins, Technical Skills, Speaking & Education).",
        "2. `coverLetterDoc`: a crisp, specific 3-paragraph cover letter citing concrete metrics/projects from the Fact Vault without clichés.",
        "",
        "CANDIDATE PROFILE:",
        JSON.stringify(profile || {}, null, 2),
        "",
        "TARGET ROLE CONTEXT:",
        JSON.stringify(application || {}, null, 2),
        "",
        jobDescription ? `JOB DESCRIPTION:\n${jobDescription.slice(0, 18000)}\n` : "",
        "VERIFIED FACT VAULT:",
        JSON.stringify(facts || [], null, 2),
      ].join("\n");

      const response = await generateWithResilience(ai, {
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              cvDoc: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  headerLine: { type: Type.STRING },
                  contactLine: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  sections: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        heading: { type: Type.STRING },
                        bullets: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                      },
                    },
                  },
                },
              },
              coverLetterDoc: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  recipientLine: { type: Type.STRING },
                  salutation: { type: Type.STRING },
                  paragraphs: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  signOff: { type: Type.STRING },
                },
              },
              citedFactIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              missingFactGap: { type: Type.STRING },
            },
          },
        },
      });

      const parsed = safeParseModelJson<Record<string, unknown>>(response.text);
      res.json({
        ...parsed,
        usage: extractUsageSummary(response),
      });
    } catch (err) {
      const { status, message } = getReadableError(err);
      res.status(status).json({ error: message });
    }
  });

  // Always return JSON for API 404s or Express body-parser/payload errors
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
  });

  app.use(
    "/api",
    (
      err: Error & { status?: number; type?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = err.status || (err.type === "entity.too.large" ? 413 : 500);
      res.status(status).json({
        error:
          err.type === "entity.too.large"
            ? "Uploaded file payload exceeded server limit. Try selecting 1 smaller file at a time."
            : err.message || "Unexpected API error.",
      });
    }
  );

  const httpServer = http.createServer(app);
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;

  let viteReady = false;
  const spaRouter = express.Router();

  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    if (!viteReady && process.env.NODE_ENV !== "production") {
      res.status(503).send("<html><body><p>Initializing workspace...</p><script>setTimeout(()=>location.reload(),800)</script></body></html>");
      return;
    }
    spaRouter(req, res, next);
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`CareerJogger server running on http://0.0.0.0:${PORT}`);
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === "true" ? false : { server: httpServer },
      },
      appType: "spa",
    });

    if (process.env.DISABLE_HMR === "true") {
      spaRouter.get("/@vite/client", (req, res, next) => {
        delete req.headers["accept-encoding"];
        const origEnd = res.end.bind(res);
        const chunks: Buffer[] = [];
        res.write = ((chunk: string | Uint8Array) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        }) as typeof res.write;
        res.end = ((chunk?: string | Uint8Array) => {
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = Buffer.concat(chunks)
            .toString("utf8")
            .replace(
              "transport.connect(createHMRHandler(handleMessage));",
              "/* HMR disabled: skipped WebSocket connect */"
            );
          res.removeHeader("Content-Length");
          res.setHeader("Content-Length", Buffer.byteLength(body));
          return origEnd(body);
        }) as typeof res.end;
        next();
      });
    }

    spaRouter.use(vite.middlewares);
    viteReady = true;
  } else {
    const distDir = path.resolve(__dirname, "dist");
    spaRouter.use(express.static(distDir));
    spaRouter.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
    viteReady = true;
  }
}

startServer().catch((err) => {
  console.error("Failed to start CareerJogger server:", err);
  process.exit(1);
});
