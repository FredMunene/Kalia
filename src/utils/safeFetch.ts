import { getFirebaseIdToken } from "../services/googleAuth";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postJson<T = Record<string, unknown>>(
  url: string,
  payload: unknown
): Promise<T> {
  const maxStartingRetries = 3;

  for (let attempt = 0; attempt <= maxStartingRetries; attempt++) {
    const idToken = await getFirebaseIdToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (idToken) {
      headers.Authorization = `Bearer ${idToken}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const rawText = await res.text();
    const isProxyBootPage =
      rawText.includes("Starting Server...") ||
      rawText.includes("starting-server") ||
      (res.status === 502 && rawText.includes("<html"));

    if (isProxyBootPage && attempt < maxStartingRetries) {
      await sleep(1500 * (attempt + 1));
      await fetch("/api/health").catch(() => {});
      continue;
    }

    let parsed: unknown = null;
    if (rawText.trim().length > 0) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const preview = rawText
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
        throw new Error(
          isProxyBootPage
            ? "Preview server proxy returned a wake-up page while waiting for the backend. Please retry in a few seconds."
            : `Server returned HTTP ${res.status} (non-JSON response${
                preview ? `: ${preview}` : ""
              }).`
        );
      }
    }

    if (!res.ok) {
      const errMsg =
        parsed &&
        typeof parsed === "object" &&
        "error" in parsed &&
        typeof (parsed as { error?: unknown }).error === "string"
          ? (parsed as { error: string }).error
          : `Request failed with HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    return (parsed ?? {}) as T;
  }

  throw new Error("Preview server is still starting. Please retry in a moment.");
}
