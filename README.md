# 24/7 Discord Voice Bot

This bot joins one voice channel and keeps reconnecting if disconnected.

## 1) Create Discord Bot

1. Open Discord Developer Portal.
2. Create an application and bot.
3. Copy the bot token.
4. Invite the bot with permissions:
  - View Channels
  - Connect
  - Speak (optional if it only needs to stay connected)

## 2) Configure Environment

Copy `.env.example` to `.env` and fill values:

- `DISCORD_TOKEN`
- `GUILD_ID`
- `VOICE_CHANNEL_ID`
- `RECONNECT_DELAY_MS` (optional)
- `HEALTHCHECK_INTERVAL_MS` (optional)
- `LOGIN_RETRY_DELAY_MS` (optional)

## 3) Run Locally

Install dependencies:

```bash
npm install
```

Start bot:

```bash
npm start
```

Dev mode with auto-reload:

```bash
npm run dev
```

## 4) Deploy on Render

Use a Background Worker (not a Web Service), so it stays running.

### Option A: Manual Dashboard Setup

1. Push this repo to GitHub.
2. In Render, create **New + -> Background Worker**.
3. Connect the repository.
4. Configure:
  - Runtime: Node
  - Build Command: `npm install`
  - Start Command: `npm start`
5. Add environment variables in Render:
  - `DISCORD_TOKEN`
  - `GUILD_ID`
  - `VOICE_CHANNEL_ID`
  - `RECONNECT_DELAY_MS` (optional, e.g. `15000`)
  - `HEALTHCHECK_INTERVAL_MS` (optional, e.g. `60000`)
  - `LOGIN_RETRY_DELAY_MS` (optional, e.g. `20000`)
6. Deploy.

### Option B: Blueprint (render.yaml)

This repo includes [render.yaml](render.yaml). In Render, choose **New + -> Blueprint** and point to this repository.

After creation, set secret env vars:

- `DISCORD_TOKEN`
- `GUILD_ID`
- `VOICE_CHANNEL_ID`

## 5) Keep It Truly 24/7

- Use a paid Render worker plan to avoid free-instance sleep behavior.
- Keep Auto-Deploy enabled.
- Check logs for:
  - `Logged in as ...`
  - `Voice connection is ready.`

## Notes

- If host/container restarts, the bot reconnects on startup.
- If Discord voice disconnects, reconnect logic retries automatically.
- Ensure the target voice channel allows the bot role to connect.
