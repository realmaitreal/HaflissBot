const path = require("node:path");

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

let localNsfwClassifierPromise = null;
let localNsfwClassifierKey = "";

function normalizeClassifierScores(payload) {
  const rows = Array.isArray(payload?.[0]) ? payload[0] : payload;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => ({
      label: String(row.label || "").toLowerCase(),
      score: Number(row.score || 0)
    }))
    .filter((row) => row.label);
}

function findNsfwScore(scores) {
  const nsfwLabels = ["nsfw", "sexy", "porn", "hentai", "explicit", "unsafe"];
  const safeLabels = ["normal", "safe", "sfw", "neutral"];

  const nsfwScore = scores
    .filter((row) => nsfwLabels.some((label) => row.label.includes(label)))
    .reduce((max, row) => Math.max(max, row.score), 0);
  const safeScore = scores
    .filter((row) => safeLabels.some((label) => row.label.includes(label)))
    .reduce((max, row) => Math.max(max, row.score), 0);

  if (nsfwScore > 0) return nsfwScore;
  if (safeScore > 0) return Math.max(0, 1 - safeScore);
  return 0;
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

function scoreLocalNsfwPredictions(predictions, config) {
  const scores = normalizeClassifierScores(predictions);
  const nsfwScore = findNsfwScore(scores);
  const percent = Math.round(nsfwScore * 100);

  if (nsfwScore < config.nsfwThreshold) {
    return {
      flagged: false,
      flags: [],
      score: percent,
      reasons: [],
      summary: `NSFW local ${percent}%`
    };
  }

  return {
    flagged: true,
    flags: ["nsfw_image"],
    score: percent,
    reasons: [`image NSFW locale (${percent}%)`],
    summary: `NSFW local ${percent}%`
  };
}

async function getLocalNsfwClassifier(config) {
  if (!config.enableLocalNsfw) return null;

  const cacheDir = path.resolve(process.cwd(), config.localNsfwCacheDir || ".cache/transformers");
  const model = config.localNsfwModel || "onnx-community/nsfw_image_detection-ONNX";
  const allowRemote = config.localNsfwAllowRemoteModels !== false;
  const classifierKey = `${model}|${cacheDir}|${allowRemote}`;

  if (localNsfwClassifierPromise && localNsfwClassifierKey === classifierKey) {
    return localNsfwClassifierPromise;
  }

  localNsfwClassifierKey = classifierKey;
  localNsfwClassifierPromise = import("@huggingface/transformers")
    .then(({ env, pipeline }) => {
      env.cacheDir = cacheDir;
      env.allowRemoteModels = allowRemote;
      return pipeline("image-classification", model);
    })
    .catch((error) => {
      localNsfwClassifierPromise = null;
      localNsfwClassifierKey = "";
      throw error;
    });

  return localNsfwClassifierPromise;
}

async function analyzeLocalNsfwAttachment(attachment, config) {
  const classifier = await getLocalNsfwClassifier(config);
  if (!classifier) {
    return {
      flagged: false,
      flags: [],
      score: 0,
      reasons: [],
      summary: "scan NSFW local désactivé"
    };
  }

  const predictions = await classifier(attachment.url, { topk: 0 });
  return scoreLocalNsfwPredictions(predictions, config);
}

async function analyzeImageAttachment(attachment, config) {
  const metadata = analyzeImageMetadata(attachment);
  const testTrigger = analyzeImageTestTrigger(attachment, config);
  const results = [metadata, testTrigger];

  if (testTrigger.flagged) {
    return mergeImageResults(results);
  }

  try {
    results.push(await analyzeLocalNsfwAttachment(attachment, config));
  } catch (error) {
    console.warn(`Local NSFW scan unavailable for ${attachment.name || attachment.url}: ${error.message}`);
  }

  return mergeImageResults(results);
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
  analyzeImageAttachment,
  analyzeImageMetadata,
  analyzeImageTestTrigger,
  analyzeLocalNsfwAttachment,
  findNsfwScore,
  getLocalNsfwClassifier,
  isImageAttachment,
  normalizeClassifierScores,
  scoreLocalNsfwPredictions
};
