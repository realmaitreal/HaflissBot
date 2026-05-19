const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMentionPrompt,
  cleanMentionContent,
  generateMentionReply,
  identityReply,
  postProcessAiReply,
  quickReply,
  truncateText
} = require("../src/chat/localModel");
const { formatFrenchWarning } = require("../src/moderation/french");
const {
  analyzeLinks,
  analyzeLinkTestTriggers,
  extractUrls,
  scoreVirusTotalStats,
  virusTotalUrlId
} = require("../src/moderation/links");
const { shouldDeleteFlaggedMessage } = require("../src/moderation/actions");
const {
  analyzeCaptionForScam,
  analyzeImageMetadata,
  analyzeImageTestTrigger,
  findNsfwScore,
  normalizeHfScores
} = require("../src/moderation/images");
const { mergeResults } = require("../src/moderation/result");
const { analyzeText, scoreBadSpeech, scoreBadWriting, scoreScamText } = require("../src/moderation/text");

test("flags obvious MrBeast scam text", () => {
  const result = analyzeText("MR BEAST GIVEAWAY!!! Claim your $1000 prize now https://bad.example");

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("scam"));
  assert.ok(result.scamScore >= 55);
});

test("does not flag normal conversation", () => {
  const result = analyzeText("salut, vous lancez une game ce soir ?");

  assert.equal(result.flagged, false);
  assert.equal(result.score, 0);
});

test("scores noisy writing", () => {
  const result = scoreBadWriting("FREEEEE NITROOOOO!!!! CLAIM NOW!!!!");

  assert.ok(result.score > 0);
  assert.ok(result.reasons.length > 0);
});

test("flags dangerous harassment as bad speech", () => {
  const result = analyzeText("go die", {
    badSpeechThreshold: 45
  });

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("bad_speech"));
  assert.ok(result.badSpeechScore >= 45);
});

test("scores personal attacks as bad speech", () => {
  const result = scoreBadSpeech("stfu idiot!!!");

  assert.ok(result.score >= 45);
  assert.ok(result.reasons.includes("insulte agressive"));
});

test("flags targeted profanity as bad speech", () => {
  const result = analyzeText("fuck you", {
    badSpeechThreshold: 45
  });

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("bad_speech"));
  assert.ok(result.badSpeechScore >= 45);
});

test("flags standalone profanity as bad speech", () => {
  for (const text of ["fuck", "putain", "merde"]) {
    const result = analyzeText(text, {
      badSpeechThreshold: 45
    });

    assert.equal(result.flagged, true, text);
    assert.ok(result.flags.includes("bad_speech"), text);
  }
});

test("bad speech is delete-eligible without a bot mention", () => {
  const result = analyzeText("tg", {
    badSpeechThreshold: 45
  });

  assert.equal(result.flagged, true);
  assert.equal(
    shouldDeleteFlaggedMessage(result, {
      deleteFlaggedMessages: false,
      deleteBadSpeechMessages: true,
      deleteBadLinkMessages: false
    }),
    true
  );
});

test("flags short French shut-up commands as bad speech", () => {
  for (const text of ["tg", "ferme la", "tais-toi"]) {
    const result = analyzeText(text, {
      badSpeechThreshold: 45
    });

    assert.equal(result.flagged, true, text);
    assert.ok(result.flags.includes("bad_speech"), text);
  }
});

test("supports bad speech test trigger", () => {
  const result = analyzeText("bad-speech-test", {
    enableTestTriggers: true,
    badSpeechThreshold: 45
  });

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("bad_speech"));
});

test("supports custom bad speech terms", () => {
  const result = analyzeText("that word is pineapple", {
    customBadSpeechTerms: ["pineapple"],
    badSpeechThreshold: 45
  });

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("bad_speech"));
});

test("scores scam text combos higher", () => {
  const result = scoreScamText("MrBeast free money giveaway claim now");

  assert.ok(result.score >= 55);
  assert.ok(result.reasons.includes("combo MrBeast + argent/cadeau"));
});

test("normalizes Hugging Face classifier responses", () => {
  const scores = normalizeHfScores([[{ label: "nsfw", score: 0.91 }]]);

  assert.deepEqual(scores, [{ label: "nsfw", score: 0.91 }]);
  assert.equal(findNsfwScore(scores), 0.91);
});

test("does not treat unknown image labels as NSFW", () => {
  const scores = normalizeHfScores([{ label: "drawing", score: 0.95 }]);

  assert.equal(findNsfwScore(scores), 0);
});

test("detects suspicious image metadata", () => {
  const result = analyzeImageMetadata({
    name: "mrbeast-free-prize.png",
    description: "",
    url: "https://cdn.example/image.png"
  });

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("mrbeast_scam_image"));
});

test("supports harmless NSFW image test trigger when enabled", () => {
  const result = analyzeImageTestTrigger(
    {
      name: "nsfw-test.png",
      description: "",
      url: "https://cdn.example/image.png"
    },
    { enableTestTriggers: true }
  );

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("nsfw_image"));
});

test("keeps harmless NSFW image test trigger disabled by default", () => {
  const result = analyzeImageTestTrigger(
    {
      name: "nsfw-test.png",
      description: "",
      url: "https://cdn.example/image.png"
    },
    { enableTestTriggers: false }
  );

  assert.equal(result.flagged, false);
});

test("detects suspicious generated image caption", () => {
  const result = analyzeCaptionForScam("a MrBeast giveaway poster offering free money");

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("mrbeast_scam_image"));
});

test("merges moderation results", () => {
  const result = mergeResults([
    { flagged: false, flags: [], reasons: [], score: 0 },
    { flagged: true, flags: ["scam"], reasons: ["lien suspect"], score: 70 }
  ]);

  assert.equal(result.flagged, true);
  assert.equal(result.score, 70);
  assert.deepEqual(result.flags, ["scam"]);
});

test("formats French warning", () => {
  const message = formatFrenchWarning({
    summary: "lien suspect",
    reasons: ["lien suspect"]
  });

  assert.match(message, /lien suspect/);
});

test("cleans bot mention from local AI prompt content", () => {
  const cleaned = cleanMentionContent("<@123> salut tu fais quoi ?", "123");

  assert.equal(cleaned, "salut tu fais quoi ?");
});

test("builds a local AI mention prompt", () => {
  const prompt = buildMentionPrompt({
    content: "réponds vite",
    authorName: "mont127"
  });

  assert.match(prompt, /mont127/);
  assert.match(prompt, /esclave de nwawir/);
  assert.match(prompt, /pas ton nom/);
  assert.match(prompt, /réponds vite/);
});

test("answers bot identity without asking the local model", () => {
  assert.equal(identityReply("tu t'appelles comment ?"), "Wesh, moi c'est esclave de nwawir.");
});

test("answers tiny chat prompts without echoing", () => {
  assert.equal(quickReply("cc"), "Wesh, ça dit quoi ?");
  assert.equal(quickReply("cv ?"), "Tranquille, et toi ?");
  assert.equal(quickReply("T puni ?"), "Pas moi frérot, je distribue les punitions.");
});

test("replaces exact AI echoes with a non-echo reply", () => {
  const result = postProcessAiReply({
    input: "Arrête de répéter ce que je dit 🤣🤣",
    output: "Arrête de répéter ce que je dit 🤣🤣"
  });

  assert.notEqual(result, "Arrête de répéter ce que je dit 🤣🤣");
});

test("truncates long local AI replies", () => {
  assert.equal(truncateText("abcdef", 4), "abc…");
});

test("generates local AI reply through Ollama-compatible API", async () => {
  const result = await generateMentionReply({
    botUserId: "123",
    config: {
      ollamaUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen2.5-coder:7b",
      aiReplyTimeoutMs: 1000,
      aiReplyMaxChars: 900
    },
    message: {
      content: "<@123> explique vite ce que tu fais",
      author: { username: "tester" }
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ message: { content: "Wesh, je suis là." } })
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "Wesh, je suis là.");
});

test("extracts normalized links from message text", () => {
  const urls = extractUrls("mate ça <https://example.com/test>, et https://x.test/a.", 5);

  assert.deepEqual(urls, ["https://example.com/test", "https://x.test/a"]);
});

test("builds VirusTotal unpadded base64url URL ids", () => {
  assert.equal(virusTotalUrlId("https://example.com/"), "aHR0cHM6Ly9leGFtcGxlLmNvbS8");
});

test("flags bad VirusTotal link scores", () => {
  const result = scoreVirusTotalStats(
    { malicious: 1, suspicious: 0, harmless: 50, undetected: 10 },
    { vtMaliciousThreshold: 1, vtSuspiciousThreshold: 2 }
  );

  assert.equal(result.flagged, true);
  assert.ok(result.flags.includes("bad_link"));
});

test("supports harmless bad-link deletion trigger when enabled", () => {
  const result = analyzeLinkTestTriggers(["https://bad-link-test.local/path"], {
    enableTestTriggers: true
  });

  assert.equal(result.flagged, true);
  assert.deepEqual(result.flags, ["bad_link"]);
});

test("analyzes links through VirusTotal-compatible report API", async () => {
  const result = await analyzeLinks(
    "check https://bad.example",
    {
      enableLinkScanning: true,
      linkScanMaxUrls: 3,
      vtApiKey: "fake-key",
      vtMaliciousThreshold: 1,
      vtSuspiciousThreshold: 2,
      linkScanTimeoutMs: 1000
    },
    async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: {
            attributes: {
              last_analysis_stats: {
                malicious: 2,
                suspicious: 0,
                harmless: 40,
                undetected: 5
              }
            }
          }
        })
    })
  );

  assert.equal(result.flagged, true);
  assert.deepEqual(result.flags, ["bad_link"]);
});
