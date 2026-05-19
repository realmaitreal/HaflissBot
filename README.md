# HaflissBot

A Discord moderation bot that can:

- catch scammy or badly written messages,
- catch bad speech such as harassment, threats, and direct insults,
- flag MrBeast-style fake giveaway scams,
- check image attachments for NSFW content with Hugging Face,
- answer with a local Ollama model when pinged,
- answer in casual French slang when it warns users.

The bot runs without paid AI keys for text checks. Image NSFW detection needs a Hugging Face token.
AI replies use Ollama locally, so they do not need a cloud API key.

## Setup

1. Install Node.js 20 or newer.
2. In the Discord Developer Portal, name the application `esclave de nwawir`.
3. Install dependencies:

```bash
npm install
```

4. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`.
5. In the Discord Developer Portal, enable these bot intents:

- `MESSAGE CONTENT INTENT`
- `SERVER MEMBERS INTENT` is optional, not required for this version.

6. Invite the bot with these permissions:

- Read Messages/View Channels
- Send Messages
- Manage Messages, only if `DELETE_FLAGGED_MESSAGES=true`
- Read Message History

7. Start it:

```bash
npm start
```

## Hugging Face image checks

Add this to `.env`:

```bash
HF_TOKEN=your_hugging-face-token
HF_NSFW_MODEL=Falconsai/nsfw_image_detection
HF_CAPTION_MODEL=Salesforce/blip-image-captioning-base
```

`HF_NSFW_MODEL` scores image safety. `HF_CAPTION_MODEL` generates a short image caption, then the bot checks that caption for MrBeast/giveaway scam signals.

## Local AI replies

When someone mentions the bot, it can answer through Ollama running on the same machine.

This project is configured to use the small local model `qwen2.5-coder:0.5b`.

```bash
ollama pull qwen2.5-coder:0.5b
```

Then set:

```bash
ENABLE_AI_REPLIES=true
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:0.5b
AI_REPLY_TIMEOUT_MS=12000
AI_REPLY_MAX_CHARS=900
```

Test it in Discord by sending:

```text
@esclave de nwawir salut, tu fais quoi ?
```

## VirusTotal link checks

Add a VirusTotal API key to `.env`:

```bash
VT_API_KEY=your-virustotal-api-key
ENABLE_LINK_SCANNING=true
DELETE_BAD_LINK_MESSAGES=true
VT_MALICIOUS_THRESHOLD=1
VT_SUSPICIOUS_THRESHOLD=2
```

The bot checks links with VirusTotal v3 URL reports. If a URL has at least `VT_MALICIOUS_THRESHOLD` malicious detections or `VT_SUSPICIOUS_THRESHOLD` suspicious detections, it flags the message as `bad_link`. With `DELETE_BAD_LINK_MESSAGES=true`, it tries to delete only those bad-link messages.

Unknown URLs are not submitted to VirusTotal by default. Set `VT_SUBMIT_UNKNOWN_URLS=true` if you want the bot to submit new URLs for analysis.

## Behavior knobs

```bash
DELETE_FLAGGED_MESSAGES=false
REPLY_TO_FLAGGED_MESSAGES=true
ENABLE_TEST_TRIGGERS=false
MOD_LOG_CHANNEL_ID=
NSFW_THRESHOLD=0.75
SCAM_THRESHOLD=55
BAD_WRITING_THRESHOLD=45
BAD_SPEECH_THRESHOLD=45
CUSTOM_BAD_SPEECH_TERMS=
DELETE_BAD_SPEECH_MESSAGES=true
ENABLE_AI_REPLIES=true
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:0.5b
AI_REPLY_TIMEOUT_MS=12000
AI_REPLY_MAX_CHARS=900
ENABLE_LINK_SCANNING=true
VT_API_KEY=
VT_MALICIOUS_THRESHOLD=1
VT_SUSPICIOUS_THRESHOLD=2
VT_SUBMIT_UNKNOWN_URLS=false
VT_ANALYSIS_WAIT_MS=2000
LINK_SCAN_TIMEOUT_MS=10000
LINK_SCAN_MAX_URLS=3
DELETE_BAD_LINK_MESSAGES=true
```

Use `DELETE_FLAGGED_MESSAGES=true` only after testing, so you do not delete false positives by accident.

## Bad Speech Checks

The bot flags `bad_speech` for harassment, threats, aggressive insults, and custom words you add in `.env`.

```bash
BAD_SPEECH_THRESHOLD=45
CUSTOM_BAD_SPEECH_TERMS=word1,word2
DELETE_BAD_SPEECH_MESSAGES=true
```

Set `DELETE_BAD_SPEECH_MESSAGES=true` to delete bad-speech messages automatically. The bot still needs Manage Messages permission in the Discord channel.

## Safe NSFW testing

Do not test by posting real explicit images in Discord. For a harmless end-to-end test, set:

```bash
ENABLE_TEST_TRIGGERS=true
```

Then upload any safe image named `nsfw-test.png`. The bot will treat it as an NSFW image only while test triggers are enabled.

For a harmless bad-link deletion test, send:

```text
https://bad-link-test.local
```

The bot will treat it as a bad VirusTotal result only while test triggers are enabled.

For a harmless bad-speech test, send:

```text
bad-speech-test
```

The bot will treat it as bad speech only while test triggers are enabled.

## What the bot says

Warnings are intentionally casual French, for example:

> Wesh, j'ai capté un truc chelou: possible scam MrBeast / giveaway fake. Calme le post deux secondes.

You can tune the voice in `src/moderation/french.js`.
