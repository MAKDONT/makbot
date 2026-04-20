# 24/7 Discord Voice Bot

This bot joins voice channels and keeps reconnecting if disconnected.

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
- `VOICE_TARGETS` (recommended for one service across multiple servers)
- `GUILD_ID` (optional single-server fallback)
- `VOICE_CHANNEL_ID` (optional single-server fallback)
- `RECONNECT_DELAY_MS` (optional)
- `HEALTHCHECK_INTERVAL_MS` (optional)
- `LOGIN_RETRY_DELAY_MS` (optional)

`VOICE_TARGETS` format:

```text
GUILD_ID:VOICE_CHANNEL_ID,GUILD_ID:VOICE_CHANNEL_ID
```

Example for 2 servers in one Railway service:

```text
VOICE_TARGETS=1485555812754522196:1485555814461739023,123456789012345678:234567890123456789
```

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

## 4) Deploy on Railway

Use a Worker service so the process runs continuously.

1. Push this repo to GitHub.
2. In Railway, create a new project and connect the repository.
3. Set service start command to `npm start`.
4. Add environment variables in Railway:
  - `DISCORD_TOKEN`
  - `VOICE_TARGETS` (recommended)
  - `GUILD_ID` (optional fallback)
  - `VOICE_CHANNEL_ID` (optional fallback)
  - `RECONNECT_DELAY_MS` (optional, e.g. `15000`)
  - `HEALTHCHECK_INTERVAL_MS` (optional, e.g. `60000`)
  - `LOGIN_RETRY_DELAY_MS` (optional, e.g. `20000`)
5. Deploy.

## 5) Keep It Truly 24/7

- Keep the Railway service always on (no sleep).
- Enable automatic restarts and auto deploy.
- Check logs for:
  - `Logged in as ...`
  - `Voice connection is ready.`

## 6) Optional Render Setup

If you return to Render later, use a Background Worker and the same environment variables.

## Notes

- If host/container restarts, the bot reconnects on startup.
- If Discord voice disconnects, reconnect logic retries automatically.
- Ensure the target voice channel allows the bot role to connect.
- One service can connect to multiple servers using `VOICE_TARGETS`.
