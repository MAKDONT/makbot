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
const voiceTargetsRaw = process.env.VOICE_TARGETS;
const reconnectDelayMs = Number(process.env.RECONNECT_DELAY_MS || 15000);
const healthcheckIntervalMs = Number(process.env.HEALTHCHECK_INTERVAL_MS || 60000);
const loginRetryDelayMs = Number(process.env.LOGIN_RETRY_DELAY_MS || 20000);

function parseVoiceTargets(rawTargets) {
  if (!rawTargets || !rawTargets.trim()) {
    return [];
  }

  return rawTargets
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const [parsedGuildId, parsedVoiceChannelId] = entry.split(":").map((part) => part.trim());
      if (!parsedGuildId || !parsedVoiceChannelId) {
        throw new Error(`Invalid VOICE_TARGETS entry: ${entry}. Expected guildId:voiceChannelId`);
      }
      return {
        guildId: parsedGuildId,
        voiceChannelId: parsedVoiceChannelId,
      };
    });
}

let voiceTargets = [];
try {
  voiceTargets = parseVoiceTargets(voiceTargetsRaw);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (voiceTargets.length === 0 && guildId && voiceChannelId) {
  voiceTargets = [{ guildId, voiceChannelId }];
}

if (!token || voiceTargets.length === 0) {
  console.error("Missing required environment variables.");
  console.error("Set DISCORD_TOKEN and either VOICE_TARGETS or GUILD_ID + VOICE_CHANNEL_ID in .env.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const reconnectTimers = new Map();
let healthcheckTimer = null;
const connectInProgress = new Set();
let loginInProgress = false;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function targetKey(target) {
  return `${target.guildId}:${target.voiceChannelId}`;
}

function scheduleReconnect(target, reason) {
  if (reconnectTimers.has(target.guildId)) {
    return;
  }

  log(
    `Scheduling reconnect in ${reconnectDelayMs}ms for guild ${target.guildId}. Reason: ${reason}`,
  );
  const timer = setTimeout(async () => {
    reconnectTimers.delete(target.guildId);
    await ensureVoiceConnection(target, "scheduled-reconnect");
  }, reconnectDelayMs);

  reconnectTimers.set(target.guildId, timer);
}

async function ensureVoiceConnection(target, reason = "healthcheck") {
  if (!client.isReady()) {
    return;
  }

  const key = targetKey(target);
  if (connectInProgress.has(key)) {
    return;
  }

  connectInProgress.add(key);
  try {
    const guild = await client.guilds.fetch(target.guildId);
    const channel = await guild.channels.fetch(target.voiceChannelId);

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
        scheduleReconnect(target, "disconnected");
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      scheduleReconnect(target, "destroyed");
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    log(`Voice connection is ready for guild ${target.guildId}.`);
  } catch (error) {
    log(`Connection attempt failed for guild ${target.guildId}: ${error.message}`);
    scheduleReconnect(target, "connect-failed");
  } finally {
    connectInProgress.delete(key);
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
  reconnectTimers.forEach((timer) => {
    clearTimeout(timer);
  });
  reconnectTimers.clear();

  if (healthcheckTimer) {
    clearInterval(healthcheckTimer);
    healthcheckTimer = null;
  }
}

async function shutdown(code = 0) {
  clearTimers();

  voiceTargets.forEach((target) => {
    try {
      const connection = getVoiceConnection(target.guildId);
      if (connection) {
        connection.destroy();
      }
    } catch (error) {
      log(`Shutdown connection cleanup error for guild ${target.guildId}: ${error.message}`);
    }
  });

  try {
    await client.destroy();
  } catch (error) {
    log(`Shutdown client cleanup error: ${error.message}`);
  }

  process.exit(code);
}

client.once("ready", async () => {
  log(`Logged in as ${client.user.tag}`);

  for (const target of voiceTargets) {
    await ensureVoiceConnection(target, "startup");
  }

  if (!healthcheckTimer) {
    healthcheckTimer = setInterval(async () => {
      for (const target of voiceTargets) {
        await ensureVoiceConnection(target, "healthcheck");
      }
    }, healthcheckIntervalMs);
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  if (!client.user || newState.id !== client.user.id) {
    return;
  }

  if (oldState.channelId && !newState.channelId) {
    const target = voiceTargets.find((item) => item.guildId === oldState.guild.id);
    if (target) {
      scheduleReconnect(target, "bot-was-disconnected-from-voice");
    }
  }
});

client.on("error", (error) => {
  log(`Client error: ${error.message}`);
});

client.on("shardError", (error) => {
  log(`Shard error: ${error.message}`);
  voiceTargets.forEach((target) => {
    scheduleReconnect(target, "shard-error");
  });
});

client.on("shardDisconnect", () => {
  voiceTargets.forEach((target) => {
    scheduleReconnect(target, "gateway-disconnect");
  });
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
