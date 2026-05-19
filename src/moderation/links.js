const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanUrlCandidate(candidate) {
  return String(candidate || "")
    .replace(/^</, "")
    .replace(/>$/, "")
    .replace(/[),.!?;:\]]+$/g, "");
}

function extractUrls(text, maxUrls = 3) {
  const urls = [];
  const seen = new Set();

  for (const match of String(text || "").matchAll(URL_PATTERN)) {
    const candidate = cleanUrlCandidate(match[0]);
    let normalized;

    try {
      normalized = new URL(candidate).toString();
    } catch {
      continue;
    }

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);

    if (urls.length >= maxUrls) break;
  }

  return urls;
}

function virusTotalUrlId(url) {
  return Buffer.from(url)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function statsFromVirusTotalPayload(payload) {
  const attrs = payload?.data?.attributes || {};
  return attrs.last_analysis_stats || attrs.stats || null;
}

function scoreVirusTotalStats(stats, config) {
  const malicious = Number(stats?.malicious || 0);
  const suspicious = Number(stats?.suspicious || 0);
  const harmless = Number(stats?.harmless || 0);
  const undetected = Number(stats?.undetected || 0);
  const flagged =
    malicious >= config.vtMaliciousThreshold ||
    suspicious >= config.vtSuspiciousThreshold;

  return {
    flagged,
    flags: flagged ? ["bad_link"] : [],
    score: malicious * 100 + suspicious * 50,
    reasons: flagged
      ? [`VirusTotal: ${malicious} malicious, ${suspicious} suspicious`]
      : [],
    summary: `VT malicious=${malicious}, suspicious=${suspicious}, harmless=${harmless}, undetected=${undetected}`,
    stats: { malicious, suspicious, harmless, undetected }
  };
}

function analyzeLinkTestTriggers(urls, config) {
  if (!config.enableTestTriggers) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "test triggers off"
    };
  }

  const hasBadLinkTest = urls.some((url) => {
    try {
      return new URL(url).hostname === "bad-link-test.local";
    } catch {
      return false;
    }
  });

  if (!hasBadLinkTest) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "aucun trigger lien test"
    };
  }

  return {
    flagged: true,
    flags: ["bad_link"],
    score: 100,
    reasons: ["déclencheur test VirusTotal"],
    summary: "test lien dangereux sans vraie URL dangereuse"
  };
}

async function requestVirusTotal(path, config, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.linkScanTimeoutMs);

  try {
    const response = await (options.fetchImpl || fetch)(`https://www.virustotal.com/api/v3${path}`, {
      method: options.method || "GET",
      headers: {
        "x-apikey": config.vtApiKey,
        ...(options.headers || {})
      },
      body: options.body,
      signal: controller.signal
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function submitUrlForAnalysis(url, config, fetchImpl) {
  const body = new URLSearchParams({ url }).toString();
  const submitted = await requestVirusTotal("/urls", config, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    fetchImpl
  });

  if (!submitted.ok) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: `VirusTotal submit failed (${submitted.status})`
    };
  }

  const analysisId = submitted.payload?.data?.id;
  if (!analysisId) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "VirusTotal submit queued"
    };
  }

  await wait(config.vtAnalysisWaitMs);

  const analysis = await requestVirusTotal(`/analyses/${encodeURIComponent(analysisId)}`, config, {
    fetchImpl
  });
  if (!analysis.ok) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: `VirusTotal analysis pending (${analysis.status})`
    };
  }

  const stats = statsFromVirusTotalPayload(analysis.payload);
  return stats
    ? scoreVirusTotalStats(stats, config)
    : {
        flagged: false,
        flags: [],
        score: 0,
        reasons: [],
        summary: "VirusTotal analysis has no stats yet"
      };
}

async function analyzeUrl(url, config, fetchImpl) {
  const report = await requestVirusTotal(`/urls/${virusTotalUrlId(url)}`, config, { fetchImpl });

  if (report.ok) {
    const stats = statsFromVirusTotalPayload(report.payload);
    return stats
      ? scoreVirusTotalStats(stats, config)
      : {
          flagged: false,
          flags: [],
          score: 0,
          reasons: [],
          summary: "VirusTotal report has no stats"
        };
  }

  if (report.status === 404 && config.vtSubmitUnknownUrls) {
    return submitUrlForAnalysis(url, config, fetchImpl);
  }

  return {
    flagged: false,
    flags: [],
    score: 0,
    reasons: [],
    summary: `VirusTotal report unavailable (${report.status})`
  };
}

function mergeLinkResults(results) {
  const flaggedResults = results.filter((result) => result.flagged);
  const flags = [...new Set(flaggedResults.flatMap((result) => result.flags))];
  const reasons = [...new Set(flaggedResults.flatMap((result) => result.reasons))];

  return {
    flagged: flags.length > 0,
    flags,
    score: flaggedResults.reduce((max, result) => Math.max(max, result.score || 0), 0),
    reasons,
    summary:
      flaggedResults.map((result) => result.summary).filter(Boolean).join(", ") ||
      "aucun lien mauvais détecté"
  };
}

async function analyzeLinks(text, config, fetchImpl = fetch) {
  if (!config.enableLinkScanning) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "scan liens désactivé"
    };
  }

  const urls = extractUrls(text, config.linkScanMaxUrls);
  if (urls.length === 0) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "aucun lien"
    };
  }

  const testTrigger = analyzeLinkTestTriggers(urls, config);
  if (testTrigger.flagged) {
    return testTrigger;
  }

  if (!config.vtApiKey) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "VirusTotal API key manquante"
    };
  }

  const results = await Promise.all(
    urls.map((url) =>
      analyzeUrl(url, config, fetchImpl).catch((error) => ({
        flagged: false,
        flags: [],
        score: 0,
        reasons: [],
        summary: `VirusTotal error: ${error.message}`
      }))
    )
  );

  return mergeLinkResults(results);
}

module.exports = {
  analyzeLinks,
  analyzeLinkTestTriggers,
  analyzeUrl,
  cleanUrlCandidate,
  extractUrls,
  scoreVirusTotalStats,
  statsFromVirusTotalPayload,
  virusTotalUrlId
};
