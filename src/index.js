const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionsBitField
} = require("discord.js");
const { generateMentionReply } = require("./chat/localModel");
const { config } = require("./config");
const { shouldDeleteFlaggedMessage } = require("./moderation/actions");
const { formatFrenchWarning } = require("./moderation/french");
const { analyzeImageAttachment, isImageAttachment } = require("./moderation/images");
const { analyzeLinks } = require("./moderation/links");
const { mergeResults } = require("./moderation/result");
const { analyzeText } = require("./moderation/text");

if (!config.discordToken) {
  console.error("Missing DISCORD_TOKEN. Copy .env.example to .env and add your bot token.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

function moderationReplyText(result) {
  return result.flags.includes("bad_speech") ? "T'ES PUNI" : formatFrenchWarning(result);
}

async function sendModLog(message, result) {
  if (!config.modLogChannelId) return;

  const channel = await message.client.channels.fetch(config.modLogChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const jumpUrl = message.url || "no message link";
  await channel.send({
    content: [
      `Signalement: ${result.flags.join(", ")}`,
      `Auteur: ${message.author.tag} (${message.author.id})`,
      `Salon: ${message.channel}`,
      `Score: ${result.score}`,
      `Raisons: ${result.reasons.join(", ")}`,
      `Message: ${jumpUrl}`
    ].join("\n")
  });
}

async function handleFlaggedMessage(message, result) {
  await sendModLog(message, result);

  if (config.replyToFlaggedMessages) {
    await message.reply({
      content: moderationReplyText(result),
      allowedMentions: { repliedUser: false }
    });
  }

  const shouldDelete = shouldDeleteFlaggedMessage(result, config);

  if (!shouldDelete || !message.guild) return;

  const botMember = await message.guild.members.fetchMe().catch(() => null);
  const canDelete = botMember?.permissionsIn(message.channel).has(PermissionsBitField.Flags.ManageMessages);

  if (!canDelete) {
    console.warn(
      `Cannot delete ${result.flags.join(", ")} message ${message.id}: missing Manage Messages in ${message.channelId}`
    );
    return;
  }

  await message.delete().catch((error) => {
    console.warn(`Could not delete flagged message ${message.id}:`, error.message);
  });
}

async function analyzeAttachments(message) {
  const checks = [];

  for (const attachment of message.attachments.values()) {
    if (!isImageAttachment(attachment)) continue;

    checks.push(
      analyzeImageAttachment(attachment, config).catch((error) => ({
        flagged: false,
        flags: [],
        score: 0,
        reasons: [`analyse image impossible: ${error.message}`],
        summary: "erreur image"
      }))
    );
  }

  return Promise.all(checks);
}

function isMentioningBot(message) {
  return Boolean(client.user?.id && message.mentions.users.has(client.user.id));
}

async function handleMentionReply(message) {
  if (!config.enableAiReplies || !isMentioningBot(message)) return false;

  console.log(`AI mention received from ${message.author.tag} in #${message.channel?.name || message.channelId}`);
  await message.channel.sendTyping().catch(() => {});
  const reply = await generateMentionReply({
    message,
    botUserId: client.user.id,
    config
  });

  await message.reply({
    content: reply.text,
    allowedMentions: { repliedUser: false }
  });

  if (!reply.ok) {
    console.warn(`Local AI reply fallback used for message ${message.id}`);
  }

  console.log(`AI mention answered for message ${message.id}`);
  return true;
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.inGuild()) return;

  const textResult = analyzeText(message.content || "", {
    scamThreshold: config.scamThreshold,
    badWritingThreshold: config.badWritingThreshold,
    badSpeechThreshold: config.badSpeechThreshold,
    customBadSpeechTerms: config.customBadSpeechTerms,
    enableTestTriggers: config.enableTestTriggers
  });
  const imageResults = await analyzeAttachments(message);
  const linkResult = await analyzeLinks(message.content || "", config);
  const result = mergeResults([textResult, linkResult, ...imageResults]);

  if (result.flagged) {
    console.log(
      `Moderation hit ${result.flags.join(", ")} from ${message.author.tag} in #${message.channel?.name || message.channelId}`
    );
    await handleFlaggedMessage(message, result).catch((error) => {
      console.error(`Failed to handle flagged message ${message.id}:`, error);
    });
    return;
  }

  await handleMentionReply(message).catch((error) => {
    console.error(`Failed to answer mention ${message.id}:`, error);
  });
});

client.login(config.discordToken);
