function shouldDeleteFlaggedMessage(result, config) {
  return Boolean(
    config.deleteFlaggedMessages ||
      (config.deleteBadSpeechMessages && result.flags.includes("bad_speech")) ||
      (config.deleteBadLinkMessages && result.flags.includes("bad_link"))
  );
}

module.exports = { shouldDeleteFlaggedMessage };
