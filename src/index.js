require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ChannelType,
} = require("discord.js");
const {
  joinVoiceChannel,
  entersState,
  getVoiceConnection,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
const voiceChannelId = process.env.VOICE_CHANNEL_ID;
const reconnectDelayMs = Number(process.env.RECONNECT_DELAY_MS || 15000);
const healthcheckIntervalMs = Number(process.env.HEALTHCHECK_INTERVAL_MS || 60000);
const loginRetryDelayMs = Number(process.env.LOGIN_RETRY_DELAY_MS || 20000);

if (!token || !guildId || !voiceChannelId) {
  console.error("Missing required environment variables.");
  console.error("Set DISCORD_TOKEN, GUILD_ID, and VOICE_CHANNEL_ID in .env.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let reconnectTimer = null;
let healthcheckTimer = null;
let connectInProgress = false;
let loginInProgress = false;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function scheduleReconnect(reason) {
  if (reconnectTimer) {
    return;
  }

  log(`Scheduling reconnect in ${reconnectDelayMs}ms. Reason: ${reason}`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await ensureVoiceConnection("scheduled-reconnect");
  }, reconnectDelayMs);
}

async function ensureVoiceConnection(reason = "healthcheck") {
  if (!client.isReady()) {
    return;
  }

  if (connectInProgress) {
    return;
  }

  connectInProgress = true;
  try {
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(voiceChannelId);

    if (!channel) {
      throw new Error("Voice channel not found");
    }

    const isVoiceChannel =
      channel.type === ChannelType.GuildVoice ||
      channel.type === ChannelType.GuildStageVoice;

    if (!isVoiceChannel) {
      throw new Error("Configured channel is not a voice/stage channel");
    }

    let connection = getVoiceConnection(guild.id);
    if (connection && connection.joinConfig.channelId === channel.id) {
      if (connection.state.status === VoiceConnectionStatus.Ready) {
        return;
      }
      connection.destroy();
      connection = null;
    }

    if (connection) {
      connection.destroy();
    }

    log(`Joining voice channel ${channel.name} (${channel.id}) [${reason}]`);

    connection = joinVoiceChannel({
      guildId: guild.id,
      channelId: channel.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        connection.destroy();
        scheduleReconnect("disconnected");
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      scheduleReconnect("destroyed");
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    log("Voice connection is ready.");
  } catch (error) {
    log(`Connection attempt failed: ${error.message}`);
    scheduleReconnect("connect-failed");
  } finally {
    connectInProgress = false;
  }
}

async function startLoginLoop() {
  if (loginInProgress) {
    return;
  }

  loginInProgress = true;
  while (!client.isReady()) {
    try {
      log("Attempting Discord login...");
      await client.login(token);
      log("Discord login succeeded.");
      break;
    } catch (error) {
      log(`Login failed: ${error.message}`);
      log(`Retrying login in ${loginRetryDelayMs}ms.`);
      await delay(loginRetryDelayMs);
    }
  }
  loginInProgress = false;
}

function clearTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (healthcheckTimer) {
    clearInterval(healthcheckTimer);
    healthcheckTimer = null;
  }
}

async function shutdown(code = 0) {
  clearTimers();

  try {
    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
    }
  } catch (error) {
    log(`Shutdown connection cleanup error: ${error.message}`);
  }

  try {
    await client.destroy();
  } catch (error) {
    log(`Shutdown client cleanup error: ${error.message}`);
  }

  process.exit(code);
}

client.once("ready", async () => {
  log(`Logged in as ${client.user.tag}`);

  await ensureVoiceConnection("startup");

  if (!healthcheckTimer) {
    healthcheckTimer = setInterval(async () => {
      await ensureVoiceConnection("healthcheck");
    }, healthcheckIntervalMs);
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (!client.user || newState.id !== client.user.id) {
    return;
  }

  if (oldState.channelId && !newState.channelId) {
    scheduleReconnect("bot-was-disconnected-from-voice");
  }
});

client.on("error", (error) => {
  log(`Client error: ${error.message}`);
});

client.on("shardError", (error) => {
  log(`Shard error: ${error.message}`);
  scheduleReconnect("shard-error");
});

client.on("shardDisconnect", () => {
  scheduleReconnect("gateway-disconnect");
});

client.on("invalidated", () => {
  log("Session invalidated. Exiting so the host can restart the worker.");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  log(`Unhandled rejection: ${message}`);
});

process.on("uncaughtException", (error) => {
  log(`Uncaught exception: ${error.stack || error.message}`);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  log("Received SIGTERM, shutting down.");
  await shutdown(0);
});

process.on("SIGINT", async () => {
  log("Received SIGINT, shutting down.");
  await shutdown(0);
});

startLoginLoop();
