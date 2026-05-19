function mergeResults(results) {
  const flaggedResults = results.filter((result) => result.flagged);
  const flags = [...new Set(flaggedResults.flatMap((result) => result.flags))];
  const reasons = [...new Set(flaggedResults.flatMap((result) => result.reasons))];

  return {
    flagged: flags.length > 0,
    flags,
    reasons,
    score: flaggedResults.reduce((max, result) => Math.max(max, result.score || 0), 0),
    summary: reasons.join(", ") || "aucun signal fort"
  };
}

module.exports = { mergeResults };
