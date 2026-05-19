const SCAM_PATTERNS = [
  { regex: /\bmr\.?\s*beast\b/i, score: 24, reason: "mention MrBeast" },
  { regex: /\b(beast\s*giveaway|mrbeast\s*giveaway)\b/i, score: 35, reason: "giveaway MrBeast" },
  { regex: /\b(free|gratuit|cadeau|gift|claim|réclame|reclame)\b/i, score: 10, reason: "promesse de cadeau" },
  { regex: /\b(nitro|robux|v[-\s]?bucks|steam|crypto|wallet)\b/i, score: 12, reason: "appât fréquent de scam" },
  { regex: /\b(click|clique|verify|vérifie|verifie|login|connecte|sign in)\b/i, score: 12, reason: "appel à cliquer ou se connecter" },
  { regex: /\b(prize|prix|winner|gagnant|won|gagné|gagne)\b/i, score: 12, reason: "promesse de gain" },
  { regex: /(https?:\/\/|discord\.gg|bit\.ly|tinyurl|t\.co|grabify|linktr\.ee)/i, score: 16, reason: "lien suspect" },
  { regex: /\b(urgent|limited|vite|maintenant|24h|last chance|dernière chance|derniere chance)\b/i, score: 10, reason: "pression d'urgence" }
];

const BAD_WRITING_PATTERNS = [
  { regex: /[A-ZÀ-Ý]{12,}/, score: 10, reason: "trop de majuscules" },
  { regex: /([!?]){4,}/, score: 8, reason: "ponctuation spam" },
  { regex: /(.)\1{5,}/i, score: 8, reason: "caractères répétés" },
  { regex: /\b(free|claim|winner|prize)\b.*\b(now|fast|today)\b/i, score: 12, reason: "anglais de scam" },
  { regex: /\b100\s*%\s*(real|legit|vrai)\b/i, score: 10, reason: "garantie trop forcée" }
];

const BAD_SPEECH_PATTERNS = [
  { regex: /\b(kys|kill\s+yourself|end\s+yourself|go\s+die|cr[eè]ve|va\s+crever)\b/i, score: 75, reason: "harcèlement dangereux" },
  { regex: /\b(i'?ll|imma|i am going to|je vais|jvais|on va)\s+(kill|hurt|stab|shoot|tuer|frapper|tabasser|planter|buter)\s+(you|u|toi|te|vous|him|her|them|quelqu'un|ce mec)\b/i, score: 65, reason: "menace directe" },
  { regex: /\b(shut\s*(?:the\s*)?f(?:u|uck)\s*up|stfu|ta\s+gueule|ferme\s+(?:la|ta\s+gueule)|tais[\s-]?toi|tg)\b/i, score: 55, reason: "insulte agressive" },
  { regex: /\b(you|u|toi|tu|t'es|tes|vous)\s+(?:are|r|es|êtes|etes)?\s*(?:a\s+|un\s+|une\s+)?(?:idiot|stupid|dumb|moron|loser|trash|clown|d[eé]bile|abruti|con(?:ne)?|connard|connasse)\b/i, score: 38, reason: "attaque personnelle" },
  { regex: /\b(fuck\s+(?:you|u)|f\W*u|ntm|nique\s+ta\s+m[eè]re|fdp)\b/i, score: 55, reason: "grossièreté ciblée" },
  { regex: /\b(fuck|shit|bitch|asshole|merde|putain|pute|salope|encul[eé])\b/i, score: 45, reason: "grossièreté" },
  { regex: /\b(idiot|stupid|dumb|moron|loser|trash|clown|d[eé]bile|abruti|connard|connasse)\b/i, score: 20, reason: "insulte" },
  { regex: /\b(all|tous\s+les|toutes\s+les)\s+.{1,30}\s+(should|must|devraient|doivent)\s+(die|disappear|crever|dispara[iî]tre)\b/i, score: 80, reason: "haine de groupe" }
];

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text, patternSet) {
  const reasons = [];
  const score = patternSet.reduce((total, pattern) => {
    if (!pattern.regex.test(text)) return total;
    reasons.push(pattern.reason);
    return total + pattern.score;
  }, 0);
  return { score, reasons };
}

function scoreBadWriting(text) {
  const compact = text.trim();
  if (!compact) return { score: 0, reasons: [] };

  const words = compact.split(/\s+/).filter(Boolean);
  const uppercaseLetters = compact.replace(/[^A-ZÀ-Ý]/g, "").length;
  const letters = compact.replace(/[^a-zA-ZÀ-ÿ]/g, "").length || 1;
  const uppercaseRatio = uppercaseLetters / letters;
  const linkCount = (compact.match(/https?:\/\/|discord\.gg/gi) || []).length;
  const emojiLikeCount = (compact.match(/<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}]/gu) || []).length;

  const base = countMatches(compact, BAD_WRITING_PATTERNS);
  const ratioScore = uppercaseRatio > 0.55 && letters > 18 ? 14 : 0;
  const shortLinkScore = linkCount >= 2 ? 12 : 0;
  const emojiScore = emojiLikeCount >= 5 ? 8 : 0;
  const veryShortScamScore =
    words.length <= 8 && /\b(free|claim|gift|nitro|prize)\b/i.test(compact) ? 8 : 0;

  const reasons = [...base.reasons];
  if (ratioScore) reasons.push("message en mode cri");
  if (shortLinkScore) reasons.push("trop de liens");
  if (emojiScore) reasons.push("trop d'emojis");
  if (veryShortScamScore) reasons.push("phrase courte de scam");

  return {
    score: clampScore(base.score + ratioScore + shortLinkScore + emojiScore + veryShortScamScore),
    reasons
  };
}

function scoreCustomBadSpeechTerms(text, terms = []) {
  const reasons = [];
  const score = terms.reduce((total, term) => {
    const clean = String(term || "").trim();
    if (!clean) return total;

    const regex = new RegExp(`\\b${escapeRegex(clean)}\\b`, "i");
    if (!regex.test(text)) return total;

    reasons.push("mot interdit personnalisé");
    return total + 45;
  }, 0);

  return {
    score,
    reasons: [...new Set(reasons)]
  };
}

function scoreBadSpeech(text, options = {}) {
  const compact = text.trim();
  if (!compact) return { score: 0, reasons: [] };

  if (options.enableTestTriggers && /\bbad-speech-test\b/i.test(compact)) {
    return {
      score: 100,
      reasons: ["déclencheur test bad speech"]
    };
  }

  const base = countMatches(compact, BAD_SPEECH_PATTERNS);
  const custom = scoreCustomBadSpeechTerms(compact, options.customBadSpeechTerms);
  const hasBadSpeech = base.score + custom.score > 0;
  const aggressivePunctuation = hasBadSpeech && /[!?]{3,}/.test(compact) ? 5 : 0;
  const repeatedInsult = hasBadSpeech && /\b(\w+)\b(?:\W+\1\b){2,}/i.test(compact) ? 8 : 0;

  const reasons = [...base.reasons, ...custom.reasons];
  if (aggressivePunctuation) reasons.push("ton agressif");
  if (repeatedInsult) reasons.push("insulte répétée");

  return {
    score: clampScore(base.score + custom.score + aggressivePunctuation + repeatedInsult),
    reasons: [...new Set(reasons)]
  };
}

function scoreScamText(text) {
  const compact = text.trim();
  if (!compact) return { score: 0, reasons: [] };

  const base = countMatches(compact, SCAM_PATTERNS);
  const hasMrBeast = /\bmr\.?\s*beast\b/i.test(compact);
  const hasMoney = /(\$\s?\d+|\d+\s?(usd|eur|€|\$)|cash|money|argent)/i.test(compact);
  const hasGiveaway = /\b(giveaway|cadeau|free|claim|prize|gagnant|winner)\b/i.test(compact);
  const comboScore = hasMrBeast && (hasMoney || hasGiveaway) ? 28 : 0;
  const suspiciousDomainScore =
    /\b(discord-nitro|steamgift|gift-airdrop|claim-prize|mrbeast.*\.(click|top|xyz|site))\b/i.test(compact)
      ? 22
      : 0;

  const reasons = [...base.reasons];
  if (comboScore) reasons.push("combo MrBeast + argent/cadeau");
  if (suspiciousDomainScore) reasons.push("domaine typique de scam");

  return {
    score: clampScore(base.score + comboScore + suspiciousDomainScore),
    reasons
  };
}

function analyzeText(text, thresholds = {}) {
  const scam = scoreScamText(text);
  const writing = scoreBadWriting(text);
  const speech = scoreBadSpeech(text, {
    customBadSpeechTerms: thresholds.customBadSpeechTerms,
    enableTestTriggers: thresholds.enableTestTriggers
  });
  const reasons = [];
  const flags = [];

  if (scam.score >= (thresholds.scamThreshold ?? 55)) {
    flags.push("scam");
    reasons.push(...scam.reasons);
  }

  if (writing.score >= (thresholds.badWritingThreshold ?? 45)) {
    flags.push("bad_writing");
    reasons.push(...writing.reasons);
  }

  if (speech.score >= (thresholds.badSpeechThreshold ?? 45)) {
    flags.push("bad_speech");
    reasons.push(...speech.reasons);
  }

  const uniqueReasons = [...new Set(reasons)];

  return {
    flagged: flags.length > 0,
    flags,
    score: Math.max(scam.score, writing.score, speech.score),
    scamScore: scam.score,
    badWritingScore: writing.score,
    badSpeechScore: speech.score,
    reasons: uniqueReasons,
    summary: uniqueReasons.join(", ") || "aucun signal fort"
  };
}

module.exports = {
  analyzeText,
  scoreBadSpeech,
  scoreBadWriting,
  scoreScamText
};
