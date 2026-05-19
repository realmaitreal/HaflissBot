const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif"
]);

function isImageAttachment(attachment) {
  if (attachment.contentType && IMAGE_CONTENT_TYPES.has(attachment.contentType)) {
    return true;
  }

  return /\.(jpe?g|png|webp|gif)$/i.test(attachment.name || attachment.url || "");
}

function normalizeHfScores(payload) {
  const rows = Array.isArray(payload?.[0]) ? payload[0] : payload;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => ({
      label: String(row.label || "").toLowerCase(),
      score: Number(row.score || 0)
    }))
    .filter((row) => row.label);
}

function findNsfwScore(hfScores) {
  const nsfwLabels = ["nsfw", "sexy", "porn", "hentai", "explicit", "unsafe"];
  const safeLabels = ["normal", "safe", "sfw", "neutral"];

  const nsfwScore = hfScores
    .filter((row) => nsfwLabels.some((label) => row.label.includes(label)))
    .reduce((max, row) => Math.max(max, row.score), 0);
  const safeScore = hfScores
    .filter((row) => safeLabels.some((label) => row.label.includes(label)))
    .reduce((max, row) => Math.max(max, row.score), 0);

  if (nsfwScore > 0) return nsfwScore;
  if (safeScore > 0) return Math.max(0, 1 - safeScore);
  return 0;
}

function captionTextFromHf(payload) {
  if (Array.isArray(payload)) {
    const first = payload[0] || {};
    return String(first.generated_text || first.caption || first.label || "");
  }

  return String(payload?.generated_text || payload?.caption || "");
}

async function queryHuggingFaceImage({ model, token, imageBuffer }) {
  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream"
    },
    body: imageBuffer
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Hugging Face ${model} failed: ${response.status} ${body}`);
  }

  return response.json();
}

async function downloadAttachment(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download attachment: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function analyzeImageMetadata(attachment) {
  const haystack = `${attachment.name || ""} ${attachment.description || ""} ${attachment.url || ""}`;
  const hasMrBeast = /\bmr\.?\s*beast\b|beast.?giveaway/i.test(haystack);
  const hasScamSignal = /\b(free|claim|gift|giveaway|winner|prize|money|cash|nitro)\b/i.test(haystack);

  if (!hasMrBeast && !hasScamSignal) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "aucun signal image fort"
    };
  }

  return {
    flagged: hasMrBeast && hasScamSignal,
    flags: hasMrBeast && hasScamSignal ? ["mrbeast_scam_image"] : [],
    score: hasMrBeast && hasScamSignal ? 60 : 25,
    reasons: hasMrBeast && hasScamSignal ? ["nom d'image MrBeast/giveaway suspect"] : ["nom d'image suspect"],
    summary: "métadonnées image suspectes"
  };
}

function analyzeImageTestTrigger(attachment, config) {
  if (!config.enableTestTriggers) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "test triggers off"
    };
  }

  const haystack = `${attachment.name || ""} ${attachment.description || ""} ${attachment.url || ""}`;
  if (!/\bnsfw-test\b/i.test(haystack)) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "aucun trigger test"
    };
  }

  return {
    flagged: true,
    flags: ["nsfw_image"],
    score: 100,
    reasons: ["déclencheur test NSFW"],
    summary: "test NSFW sans image explicite"
  };
}

function analyzeCaptionForScam(caption) {
  const text = caption.trim();
  if (!text) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "caption vide"
    };
  }

  const hasMrBeast = /\bmr\.?\s*beast\b|jimmy donaldson/i.test(text);
  const hasScamSignal = /\b(giveaway|money|cash|dollars|winner|prize|click|claim|free)\b/i.test(text);

  if (!hasMrBeast && !hasScamSignal) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: text
    };
  }

  return {
    flagged: hasMrBeast && hasScamSignal,
    flags: hasMrBeast && hasScamSignal ? ["mrbeast_scam_image"] : [],
    score: hasMrBeast && hasScamSignal ? 70 : 30,
    reasons: hasMrBeast && hasScamSignal ? ["image type MrBeast giveaway fake"] : ["caption image suspecte"],
    summary: text
  };
}

async function analyzeImageAttachment(attachment, config) {
  const metadata = analyzeImageMetadata(attachment);
  const testTrigger = analyzeImageTestTrigger(attachment, config);

  if (!config.hfToken) {
    return mergeImageResults([metadata, testTrigger]);
  }

  const flags = [];
  const reasons = [];
  let nsfwScore = 0;

  for (const result of [metadata, testTrigger]) {
    if (!result.flagged) continue;
    flags.push(...result.flags);
    reasons.push(...result.reasons);
  }

  let imageBuffer;
  try {
    imageBuffer = await downloadAttachment(attachment.url);
  } catch (error) {
    return {
      flagged: flags.length > 0,
      flags: [...new Set(flags)],
      score: Math.max(metadata.score, testTrigger.score),
      reasons: [...new Set(reasons)],
      summary: `image impossible à télécharger: ${error.message}`
    };
  }

  try {
    const nsfwPayload = await queryHuggingFaceImage({
      model: config.hfNsfwModel,
      token: config.hfToken,
      imageBuffer
    });
    const nsfwScores = normalizeHfScores(nsfwPayload);
    nsfwScore = findNsfwScore(nsfwScores);
  } catch (error) {
    reasons.push(`analyse NSFW indisponible: ${error.message}`);
  }

  if (nsfwScore >= config.nsfwThreshold) {
    flags.push("nsfw_image");
    reasons.push(`image NSFW (${Math.round(nsfwScore * 100)}%)`);
  }

  let captionResult = {
    flagged: false,
    flags: [],
    score: 0,
    reasons: [],
    summary: ""
  };

  if (config.hfCaptionModel) {
    try {
      const captionPayload = await queryHuggingFaceImage({
        model: config.hfCaptionModel,
        token: config.hfToken,
        imageBuffer
      });
      captionResult = analyzeCaptionForScam(captionTextFromHf(captionPayload));
    } catch (error) {
      reasons.push(`caption image indisponible: ${error.message}`);
    }
  }

  if (captionResult.flagged) {
    flags.push(...captionResult.flags);
    reasons.push(...captionResult.reasons);
  }

  const uniqueFlags = [...new Set(flags)];
  const uniqueReasons = [...new Set(reasons)];

  return {
    flagged: uniqueFlags.length > 0,
    flags: uniqueFlags,
    score: Math.max(Math.round(nsfwScore * 100), metadata.score, testTrigger.score, captionResult.score),
    reasons: uniqueReasons,
    summary: captionResult.summary || metadata.summary
  };
}

function mergeImageResults(results) {
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
      "aucun signal image fort"
  };
}

module.exports = {
  analyzeCaptionForScam,
  analyzeImageAttachment,
  analyzeImageMetadata,
  analyzeImageTestTrigger,
  captionTextFromHf,
  findNsfwScore,
  isImageAttachment,
  normalizeHfScores
};
