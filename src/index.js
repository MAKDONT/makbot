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

client.on("shardDisconnect", () => {
  scheduleReconnect("gateway-disconnect");
});

client.login(token).catch((error) => {
  log(`Login failed: ${error.message}`);
  process.exit(1);
});
