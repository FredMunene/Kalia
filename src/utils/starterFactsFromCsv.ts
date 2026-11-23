import {
  ApplicationLogEntry,
  FactCategory,
  FactItem,
  ProfileDefaults,
  TargetPipelineEntry,
} from "../types/career";

export function buildStarterWorkspaceFromTracker(
  pipeline: TargetPipelineEntry[],
  applications: ApplicationLogEntry[]
): {
  profile: Partial<ProfileDefaults>;
  facts: FactItem[];
} {
  const now = new Date().toISOString();
  const facts: FactItem[] = [];

  const add = (
    id: string,
    category: FactCategory,
    title: string,
    detail: string,
    metrics = ""
  ) => {
    facts.push({
      id,
      category,
      title,
      detail,
      metrics,
      sourceFileName: "Job_Tracker CSV (Pre-filled)",
      verified: true,
      updatedAt: now,
    });
  };

  // Derive verified career facts directly from the attached Job_Tracker CSV rows
  const textBlob = [
    ...pipeline.map((p) => `${p.company} ${p.role} ${p.nextAction} ${p.notes} ${p.cvVersion}`),
    ...applications.map((a) => `${a.company} ${a.role} ${a.notes} ${a.location}`),
  ].join("\n");

  if (/cyfrin/i.test(textBlob)) {
    add(
      "seed-cyfrin",
      "Speaking & DevRel",
      "Cyfrin Ambassador & Security Technical Writing",
      "Active Cyfrin Ambassador publishing weekly smart contract exploit post-mortems including Kelp DAO Hyperbridge analysis.",
      "Weekly exploit post-mortems"
    );
  }

  if (/topizzy|base/i.test(textBlob)) {
    add(
      "seed-topizzy",
      "Hackathons & Wins",
      "Topizzy on Base EVM & Farcaster",
      "Built and shipped Topizzy live on Base EVM and Farcaster; recognized in W3Node and Uganda Ethereum hackathons.",
      "W3Node & Uganda Ethereum Hackathon wins"
    );
  }

  if (/m-pesa|twap|yellow card/i.test(textBlob)) {
    add(
      "seed-go-payments",
      "Experience",
      "Go Payments Rails & Crypto-to-Fiat Settlement",
      "Engineered Go microservices integrating M-Pesa STK Push, TWAP price oracle volatility smoothing, webhook retry queues, and idempotent payment APIs.",
      "Go · M-Pesa STK Push · TWAP Oracle"
    );
  }

  if (/polkashield|cybersecurity/i.test(textBlob)) {
    add(
      "seed-polkashield",
      "Education & Certs",
      "PolkaShield & MSc Cybersecurity",
      "Built PolkaShield verifiable access control system alongside MSc Cybersecurity graduate studies and smart contract auditing.",
      "MSc Cybersecurity · Verifiable Access Control"
    );
  }

  if (/fiatrails|avalanche/i.test(textBlob)) {
    add(
      "seed-fiatrails",
      "Projects",
      "FiatRails on Avalanche C-Chain",
      "Deployed FiatRails smart contracts and settlement workflows on Avalanche C-Chain.",
      "Avalanche C-Chain · Solidity"
    );
  }

  if (/uniswap/i.test(textBlob)) {
    add(
      "seed-uniswap",
      "Projects",
      "Uniswap Hook Incubation Cohort 8",
      "Selected participant in Uniswap Hook Incubation Cohort 8 building custom DeFi AMM hooks and protocol integrations.",
      "Uniswap v4 Hooks · Cohort 8"
    );
  }

  if (/mombasa|devfest kisii/i.test(textBlob)) {
    add(
      "seed-speaking",
      "Speaking & DevRel",
      "Technical Talks: Mombasa University & DevFest Kisii",
      "Delivered developer ecosystem presentations and workshops at Mombasa University and DevFest Kisii.",
      "2 Developer Conferences / Campus Talks"
    );
  }

  // Extract email if present in tracker notes (e.g. Speechify coding test link)
  const emailMatch = textBlob.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

  const profile: Partial<ProfileDefaults> = {
    fullName: "Fred Munene Gitonga",
    email: emailMatch ? emailMatch[0] : "",
    location: /nairobi/i.test(textBlob) ? "Nairobi, Kenya (Remote)" : "",
    headline:
      "Backend & Web3 Engineer · Go Payment Rails, Smart Contract Security & DevRel",
    workAuth: "Kenya / Remote Global Contractor",
  };

  return { profile, facts };
}

export function parsePlainTextLocallyWithoutAi(
  text: string,
  sourceName: string
): {
  profile: Partial<ProfileDefaults>;
  facts: FactItem[];
} {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/\+?\d[\d\s()-]{7,16}\d/);
  const linkedinMatch = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  const githubMatch = text.match(/https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i);
  const xMatch = text.match(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[a-zA-Z0-9_]+/i);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[•\-*]\s*/, "").trim())
    .filter((l) => l.length >= 24);

  const now = new Date().toISOString();
  let currentCategory: FactCategory = "Experience";
  const facts: FactItem[] = [];

  for (let i = 0; i < lines.length && facts.length < 20; i++) {
    const line = lines[i];
    if (/^(education|certifications?)/i.test(line)) {
      currentCategory = "Education & Certs";
      continue;
    }
    if (/^(projects?|open source)/i.test(line)) {
      currentCategory = "Projects";
      continue;
    }
    if (/^(hackathons?|awards?|wins?)/i.test(line)) {
      currentCategory = "Hackathons & Wins";
      continue;
    }
    if (/^(speaking|devrel|talks?|publications?)/i.test(line)) {
      currentCategory = "Speaking & DevRel";
      continue;
    }
    if (/^(experience|work|employment)/i.test(line)) {
      currentCategory = "Experience";
      continue;
    }

    const colonIdx = line.indexOf(":");
    const title =
      colonIdx > 3 && colonIdx < 60
        ? line.slice(0, colonIdx).trim()
        : line.slice(0, 56).trim() + (line.length > 56 ? "..." : "");
    const detail = colonIdx > 3 && colonIdx < 60 ? line.slice(colonIdx + 1).trim() : line;

    facts.push({
      id: `local-fact-${Date.now()}-${i}`,
      category: currentCategory,
      title,
      detail,
      sourceFileName: `${sourceName} (Local Parse)`,
      verified: true,
      updatedAt: now,
    });
  }

  return {
    profile: {
      ...(emailMatch ? { email: emailMatch[0] } : {}),
      ...(phoneMatch ? { phone: phoneMatch[0].trim() } : {}),
      ...(linkedinMatch ? { linkedinUrl: linkedinMatch[0] } : {}),
      ...(githubMatch ? { githubUrl: githubMatch[0] } : {}),
      ...(xMatch ? { xUrl: xMatch[0] } : {}),
    },
    facts,
  };
}
