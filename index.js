// index.js
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const { Shoukaku, Connectors, LoadType } = require('shoukaku');
const ytdlp = require('youtube-dl-exec');
const ytSearch = require('yt-search');
const fs = require('fs');
const path = require('path');

// Các bộ lọc âm thanh của Lavalink. key = giá trị chọn trong lệnh /filter.
// Lavalink áp filter trực tiếp lên bài đang phát, không cần phát lại từ đầu.
const FILTERS = {
  off: {},
  bassboost: { equalizer: [0, 1, 2, 3].map((band) => ({ band, gain: 0.3 })) },
  nightcore: { timescale: { rate: 1.25 } },
  '8d': { rotation: { rotationHz: 0.09 } },
  treble: { equalizer: [10, 11, 12, 13, 14].map((band) => ({ band, gain: 0.25 })) },
  vaporwave: { timescale: { rate: 0.8 } },
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Lavalink chạy cạnh bot (xem lavalink/application.yml). Mặc định nghe ở 127.0.0.1:2333.
const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  [{
    name: 'main',
    url: process.env.LAVALINK_URL || '127.0.0.1:2333',
    auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
  }],
  // Lavalink khởi động lại (JVM) mất vài chục giây -> thử kết nối lại mãi, đừng bỏ cuộc
  { reconnectTries: Infinity, reconnectInterval: 5 },
);

shoukaku.on('ready', (name, lavalinkResume) => {
  console.log(`Lavalink "${name}" đã sẵn sàng.`);
  // Lavalink vừa khởi động lại -> mọi player cũ trên node này đã mất, dọn hàng đợi
  if (lavalinkResume) return;
  for (const [guildId, queue] of queues) {
    if (queue.player.node.name === name) void destroyQueue(guildId);
  }
});
shoukaku.on('error', (name, err) => console.error(`Lỗi Lavalink "${name}":`, err?.message || err));
shoukaku.on('close', (name, code, reason) => console.warn(`Mất kết nối Lavalink "${name}" (${code}) ${reason || ''}`));

// Lưu trữ hàng đợi (queue) cho mỗi server (guild), key = guildId
// queue = { player, songs: [{title, url, encoded?}], textChannelId, playing, filter }
const queues = new Map();

function isYoutubeUrl(text) {
  return /^https?:\/\/(www\.|music\.|m\.)?(youtube\.com|youtu\.be)\//i.test((text || '').trim());
}

function isUrl(text) {
  return /^https?:\/\//i.test((text || '').trim());
}

// Trên máy chủ cloud, YouTube chặn Lavalink (IP datacenter) nhưng yt-dlp có cookies vẫn qua.
// Đặt YT_VIA_YTDLP=1 để bỏ qua bước thử Lavalink với YouTube, đi thẳng yt-dlp cho nhanh.
const FORCE_YTDLP = process.env.YT_VIA_YTDLP === '1';

// Tuỳ chọn chung cho mọi lần gọi yt-dlp.
// - jsRuntimes: dùng Node có sẵn để giải n-challenge của YouTube (không có sẽ bị 403 khi tải)
// - cookies: đặt YTDL_COOKIES=đường/dẫn/cookies.txt trong .env khi host bị YouTube chặn IP
//   (VPS/cloud). Chạy ở máy cá nhân thì không cần.
const YTDLP_BASE = {
  noWarnings: true,
  jsRuntimes: 'node',
  ...(process.env.YTDL_COOKIES ? { cookies: process.env.YTDL_COOKIES } : {}),
};

function getNode() {
  const node = shoukaku.getIdealNode();
  if (!node) throw new Error('Lavalink chưa sẵn sàng');
  return node;
}

function trackToSong(track) {
  return { title: track.info.title, url: track.info.uri, encoded: track.encoded };
}

// Đổi kết quả loadtracks của Lavalink thành { songs, playlistTitle }, hoặc null nếu không có gì
function lavalinkToSongs(res) {
  switch (res?.loadType) {
    case LoadType.TRACK:
      return { songs: [trackToSong(res.data)], playlistTitle: null };
    case LoadType.SEARCH:
      return res.data.length ? { songs: [trackToSong(res.data[0])], playlistTitle: null } : null;
    case LoadType.PLAYLIST:
      return {
        songs: res.data.tracks.slice(0, 100).map(trackToSong), // giới hạn 100 bài
        playlistTitle: res.data.info.name || 'Playlist',
      };
    default:
      return null;
  }
}

// Link có chứa list= -> là playlist
function isPlaylistUrl(text) {
  return /[?&]list=/.test((text || '').trim());
}

// Đường dự phòng khi Lavalink không lấy được thông tin YouTube: yt-dlp (link) / yt-search (từ khoá).
// Bài lấy theo đường này không có `encoded`, lúc phát sẽ đi qua yt-dlp.
async function resolveTracksYtdlp(input) {
  if (!isYoutubeUrl(input)) {
    const result = await ytSearch(input);
    const video = result.videos[0];
    return { songs: video ? [{ title: video.title, url: video.url }] : [], playlistTitle: null };
  }

  if (isPlaylistUrl(input)) {
    try {
      const info = await ytdlp(input, {
        ...YTDLP_BASE,
        dumpSingleJson: true,
        flatPlaylist: true,
        skipDownload: true,
      });
      const entries = Array.isArray(info?.entries) ? info.entries : [];
      const songs = entries
        .filter((e) => e && e.id && e.title && !/^\[(Deleted|Private|Unavailable)/i.test(e.title))
        .slice(0, 100)
        .map((e) => ({
          title: e.title,
          url: e.url && /^https?:/.test(e.url)
            ? e.url
            : `https://www.youtube.com/watch?v=${e.id}`,
        }));
      if (songs.length > 0) {
        return { songs, playlistTitle: info.title || 'Playlist' };
      }
      // playlist rỗng -> rơi xuống xử lý như video đơn
    } catch (err) {
      console.error('Không lấy được playlist, thử phát như video đơn:', err?.message || err);
    }
  }

  const info = await ytdlp(input, {
    ...YTDLP_BASE,
    dumpSingleJson: true,
    noPlaylist: true,
    skipDownload: true,
  });
  return { songs: [{ title: info.title, url: info.webpage_url || input }], playlistTitle: null };
}

// Trả về { songs: [{title,url,encoded?}], playlistTitle }. Luôn là mảng (1 hoặc nhiều bài).
async function resolveTracks(input) {
  const text = input.trim();
  const identifier = isUrl(text) ? text : `ytsearch:${text}`;

  let res;
  try {
    res = await getNode().rest.resolve(identifier);
  } catch (err) {
    console.error('Lavalink không tìm được bài:', err?.message || err);
  }
  const found = lavalinkToSongs(res);
  if (found) return found;

  if (res?.loadType === LoadType.ERROR) {
    console.warn(`Lavalink báo lỗi với "${text}":`, res.data?.message);
  }
  // Link không phải YouTube (SoundCloud...) thì yt-dlp cũng không giúp gì
  if (isUrl(text) && !isYoutubeUrl(text)) return { songs: [], playlistTitle: null };
  return resolveTracksYtdlp(text);
}

// Thư mục chứa file audio yt-dlp tải về. Lavalink đọc file ở đây qua nguồn `local`,
// nên Lavalink phải chạy cùng máy và cùng user với bot.
const AUDIO_DIR = path.resolve(process.env.AUDIO_CACHE_DIR || path.join(__dirname, 'cache'));
fs.rmSync(AUDIO_DIR, { recursive: true, force: true }); // file sót lại từ lần chạy trước
fs.mkdirSync(AUDIO_DIR, { recursive: true });

function dropFile(song) {
  if (!song?.file) return;
  fs.rm(song.file, { force: true }, () => {});
  song.file = null;
}

// yt-dlp (có cookies) tự tải audio YouTube về ổ đĩa, rồi Lavalink phát file đó.
// Không đưa link googlevideo cho Lavalink được: YouTube trả 403 vì Lavalink không gửi
// kèm header/token như yt-dlp.
async function encodeViaYtdlp(node, song) {
  const out = await ytdlp(song.url, {
    ...YTDLP_BASE,
    format: 'bestaudio[ext=webm]/bestaudio',
    output: path.join(AUDIO_DIR, `${Date.now()}-%(id)s.%(ext)s`),
    print: 'after_move:filepath',
    noSimulate: true,
    noPlaylist: true,
    noProgress: true,
  });
  const file = String(out).trim().split('\n').pop();
  if (!file || !fs.existsSync(file)) throw new Error('yt-dlp không tải được file audio');
  song.file = file;

  const res = await node.rest.resolve(file);
  if (res?.loadType !== LoadType.TRACK) {
    dropFile(song);
    throw new Error(`Lavalink không mở được file từ yt-dlp (${res?.loadType}: ${res?.data?.message || ''})`);
  }
  return res.data.encoded;
}

function getQueue(guildId) {
  return queues.get(guildId);
}

async function destroyQueue(guildId) {
  dropFile(queues.get(guildId)?.songs[0]);
  queues.delete(guildId);
  try {
    await shoukaku.leaveVoiceChannel(guildId);
  } catch (err) {
    // kết nối có thể đã bị huỷ từ trước — bỏ qua
  }
}

async function sendToQueueChannel(queue, content) {
  try {
    let textChannel = client.channels.cache.get(queue.textChannelId);
    if (!textChannel) {
      textChannel = await client.channels.fetch(queue.textChannelId);
    }
    if (textChannel && typeof textChannel.send === 'function') {
      await textChannel.send({
        embeds: [new EmbedBuilder().setColor(0x1DB954).setDescription(content)],
      });
    } else {
      console.warn('textChannel not sendable', queue.textChannelId);
    }
  } catch (err) {
    console.error('Không thể gửi thông báo vào channel:', err);
  }
}

function createQueue(guildId, player, textChannelId) {
  const queue = {
    player,
    songs: [],
    textChannelId,
    playing: false,
    filter: 'off',
  };
  queues.set(guildId, queue);

  player.on('end', (event) => {
    // replaced: bài bị thay bằng playTrack() khác; cleanup: player bị huỷ -> không làm gì
    if (event.reason === 'replaced' || event.reason === 'cleanup') return;
    if (queues.get(guildId) !== queue) return;

    const song = queue.songs[0];
    // Lavalink tự lấy YouTube thất bại (thường do bị chặn IP) -> thử lại bài này qua yt-dlp
    if (event.reason === 'loadFailed' && song && !song.viaYtdlp && isYoutubeUrl(song.url)) {
      console.warn(`Lavalink không phát được "${song.title}", chuyển sang yt-dlp.`);
      song.viaYtdlp = true;
      void playNext(guildId, { announce: false }).catch((e) => console.error('playNext error:', e));
      return;
    }

    // Bài phát xong, bị skip hoặc lỗi hẳn -> phát bài tiếp theo
    dropFile(queue.songs.shift());
    void playNext(guildId).catch((e) => console.error('playNext error:', e));
  });

  player.on('exception', (event) => {
    // Sau exception Lavalink sẽ gửi 'end' (loadFailed) -> handler ở trên lo phần còn lại
    const ex = event.exception;
    console.error(`Lỗi Lavalink khi phát "${queue.songs[0]?.title}":`, ex?.message, ex?.cause || '');
  });

  player.on('stuck', () => {
    console.warn(`Bài "${queue.songs[0]?.title}" bị kẹt, bỏ qua.`);
    void player.stopTrack().catch(() => {});
  });

  player.on('closed', (event) => {
    console.warn(`Kết nối thoại bị đóng (${event.code}) ${event.reason || ''}`);
  });

  return queue;
}

async function playNext(guildId, { announce = true } = {}) {
  const queue = getQueue(guildId);
  if (!queue) return;

  const song = queue.songs[0];
  if (!song) {
    queue.playing = false;
    // Không còn bài nào -> để bot đứng yên trong kênh thoại (không tự leave)
    return;
  }
  queue.playing = true;

  try {
    const useYtdlp = !song.encoded || song.viaYtdlp || (FORCE_YTDLP && isYoutubeUrl(song.url));
    const encoded = useYtdlp ? await encodeViaYtdlp(queue.player.node, song) : song.encoded;
    if (queues.get(guildId) !== queue) return; // bị /stop hoặc /leave trong lúc chờ yt-dlp
    await queue.player.playTrack({ track: { encoded } });
  } catch (err) {
    const detail = (err?.stderr || '').trim().split('\n').pop() || err?.message || err;
    console.error(`Không phát được "${song.title}":`, detail);
    if (queues.get(guildId) !== queue) return;
    await sendToQueueChannel(queue, `❌ Không phát được **${song.title}**, bỏ qua.`);
    dropFile(queue.songs.shift());
    return playNext(guildId);
  }

  if (announce) await sendToQueueChannel(queue, `🎶 Đang phát: **${song.title}**`);
}

// Bot bị kick / bị ngắt khỏi kênh thoại -> dọn hàng đợi
client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.id !== client.user?.id) return;
  if (oldState.channelId && !newState.channelId && queues.has(newState.guild.id)) {
    void destroyQueue(newState.guild.id);
  }
});

// use the non-deprecated clientReady event in newer discord.js
client.once('clientReady', () => {
  console.log(`Đã đăng nhập với tên ${client.user.tag}`);
});

const QUEUE_PAGE_SIZE = 10;

// Dựng embed + nút cho một trang hàng đợi
function buildQueuePage(queue, page) {
  const songs = queue.songs;
  const totalPages = Math.max(1, Math.ceil(songs.length / QUEUE_PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), totalPages - 1);
  const start = current * QUEUE_PAGE_SIZE;
  const pageSongs = songs.slice(start, start + QUEUE_PAGE_SIZE);

  const lines = pageSongs.map((s, idx) => {
    const globalIndex = start + idx;
    const title = s.title.length > 80 ? s.title.slice(0, 77) + '...' : s.title;
    return `${globalIndex === 0 ? '▶️' : `${globalIndex}.`} ${title}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x1DB954)
    .setTitle('🎵 Hàng đợi')
    .setDescription(lines.join('\n') || 'Trống')
    .setFooter({ text: `Trang ${current + 1}/${totalPages} • Tổng cộng ${songs.length} bài` });

  const atStart = current === 0;
  const atEnd = current >= totalPages - 1;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('queue_first')
      .setLabel('⏮ Đầu')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atStart),
    new ButtonBuilder()
      .setCustomId('queue_prev')
      .setLabel('◀ Trước')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atStart),
    new ButtonBuilder()
      .setCustomId('queue_next')
      .setLabel('Tiếp ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atEnd),
    new ButtonBuilder()
      .setCustomId('queue_last')
      .setLabel('Cuối ⏭')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(atEnd),
  );

  return { embed, row, totalPages, current };
}

// Interaction đã hết hạn (quá 3 giây) hoặc đã được trả lời rồi. Cả hai trường hợp
// đều không thể gửi thêm gì nữa, nên đừng thử lại cho rác log.
const DEAD_INTERACTION_CODES = new Set([10062, 40060]);
const isDeadInteraction = (err) => DEAD_INTERACTION_CODES.has(err?.code);

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (err) {
    if (isDeadInteraction(err)) {
      const name = interaction.isChatInputCommand() ? `/${interaction.commandName}` : 'interaction';
      console.warn(`${name}: Discord đã đóng interaction trước khi bot kịp trả lời (code ${err.code}).`);
      return;
    }

    console.error('Lỗi xử lý lệnh:', err);
    try {
      if (interaction.isRepliable()) {
        const msg = '❌ Có lỗi xảy ra khi xử lý lệnh.';
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg);
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      }
    } catch (e2) {
      if (isDeadInteraction(e2)) return;
      console.error('Không thể gửi thông báo lỗi:', e2);
    }
  }
});

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const commandName = interaction.commandName;
  const guild = interaction.guild;
  const member = interaction.member;

  if (!guild) return interaction.reply({ content: '⚠️ Lệnh này chỉ dùng trong server (guild).', flags: MessageFlags.Ephemeral });

  if (commandName === 'play') {
    const input = interaction.options.getString('link');
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({ content: '⚠️ Bạn cần vào một kênh thoại trước đã!', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    let songs;
    let playlistTitle = null;
    try {
      const result = await resolveTracks(input);
      songs = result.songs;
      playlistTitle = result.playlistTitle;
    } catch (err) {
      console.error(err);
      return interaction.editReply('❌ Không lấy được thông tin bài hát này. Kiểm tra lại link nhé.');
    }

    if (!songs || songs.length === 0) {
      return interaction.editReply('❌ Không tìm thấy bài hát nào phù hợp.');
    }

    let queue = getQueue(guild.id);

    if (!queue) {
      let player;
      try {
        player = await shoukaku.joinVoiceChannel({
          guildId: guild.id,
          channelId: voiceChannel.id,
          shardId: guild.shardId,
          deaf: true,
        });
      } catch (err) {
        console.error('Không vào được kênh thoại:', err?.message || err);
        await destroyQueue(guild.id);
        return interaction.editReply('❌ Không thể kết nối vào kênh thoại.');
      }

      queue = createQueue(guild.id, player, interaction.channelId);
    }

    const wasIdle = !queue.playing;
    for (const s of songs) queue.songs.push(s);

    if (wasIdle) void playNext(guild.id).catch((e) => console.error('playNext error:', e));

    // Thông báo tuỳ theo thêm playlist hay 1 bài
    if (songs.length > 1) {
      return interaction.editReply(
        `✅ Đã thêm **${songs.length}** bài từ playlist${playlistTitle ? ` **${playlistTitle}**` : ''} vào hàng đợi.` +
        (wasIdle ? `\n▶️ Bắt đầu phát: **${songs[0].title}**` : ''),
      );
    }
    if (wasIdle) {
      return interaction.editReply(`✅ Đã thêm và bắt đầu phát: **${songs[0].title}**`);
    }
    return interaction.editReply(`➕ Đã thêm vào hàng đợi: **${songs[0].title}** (vị trí ${queue.songs.length})`);
  }

  if (commandName === 'skip') {
    const queue = getQueue(guild.id);
    if (!queue || !queue.playing) {
      return interaction.reply({ content: 'Hiện không có bài nào đang phát.', flags: MessageFlags.Ephemeral });
    }
    await queue.player.stopTrack(); // sẽ trigger 'end' (stopped) -> tự phát bài tiếp theo
    return interaction.reply('⏭️ Đã bỏ qua bài hát.');
  }

  if (commandName === 'stop') {
    const queue = getQueue(guild.id);
    if (!queue) {
      return interaction.reply({ content: 'Bot không ở trong kênh thoại nào.', flags: MessageFlags.Ephemeral });
    }
    await destroyQueue(guild.id);
    return interaction.reply('⏹️ Đã dừng nhạc và rời kênh thoại.');
  }

  if (commandName === 'pause') {
    const queue = getQueue(guild.id);
    if (!queue || !queue.playing) {
      return interaction.reply({ content: 'Không có bài nào đang phát.', flags: MessageFlags.Ephemeral });
    }
    await queue.player.setPaused(true);
    return interaction.reply('⏸️ Đã tạm dừng.');
  }

  if (commandName === 'resume') {
    const queue = getQueue(guild.id);
    if (!queue) {
      return interaction.reply({ content: 'Không có bài nào đang chờ.', flags: MessageFlags.Ephemeral });
    }
    await queue.player.setPaused(false);
    return interaction.reply('▶️ Tiếp tục phát.');
  }

  if (commandName === 'queue') {
    const queue = getQueue(guild.id);
    if (!queue || queue.songs.length === 0) {
      return interaction.reply('Hàng đợi đang trống.');
    }

    let page = 0;
    const first = buildQueuePage(queue, page);

    // Nếu chỉ có 1 trang thì không cần nút
    const response = await interaction.reply({
      embeds: [first.embed],
      components: first.totalPages > 1 ? [first.row] : [],
    });

    if (first.totalPages <= 1) return;

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      idle: 60000, // nút tự tắt sau 60 giây không dùng
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'Chỉ người gọi lệnh mới bấm được nút này.', flags: MessageFlags.Ephemeral });
      }
      const totalPages = Math.max(1, Math.ceil(queue.songs.length / QUEUE_PAGE_SIZE));
      if (i.customId === 'queue_next') page += 1;
      else if (i.customId === 'queue_prev') page -= 1;
      else if (i.customId === 'queue_first') page = 0;
      else if (i.customId === 'queue_last') page = totalPages - 1;

      const built = buildQueuePage(queue, page);
      page = built.current; // kẹp lại phòng khi hàng đợi thay đổi
      await i.update({ embeds: [built.embed], components: [built.row] });
    });

    collector.on('end', async () => {
      // Hết thời gian -> gỡ nút cho gọn
      try {
        await interaction.editReply({ components: [] });
      } catch (err) {
        // tin nhắn có thể đã bị xoá — bỏ qua
      }
    });

    return;
  }

  if (commandName === 'nowplaying') {
    const queue = getQueue(guild.id);
    if (!queue || !queue.playing || !queue.songs[0]) {
      return interaction.reply({ content: 'Hiện không có bài nào đang phát.', flags: MessageFlags.Ephemeral });
    }
    const fx = queue.filter && queue.filter !== 'off' ? ` (hiệu ứng: ${queue.filter})` : '';
    return interaction.reply(`🎶 Đang phát: **${queue.songs[0].title}**${fx}`);
  }

  if (commandName === 'filter') {
    const queue = getQueue(guild.id);
    if (!queue) {
      return interaction.reply({ content: 'Bot không ở trong kênh thoại nào.', flags: MessageFlags.Ephemeral });
    }
    const choice = interaction.options.getString('loai');
    if (!(choice in FILTERS)) {
      return interaction.reply({ content: 'Hiệu ứng không hợp lệ.', flags: MessageFlags.Ephemeral });
    }

    // Filter gắn với player nên tự áp cho cả các bài sau, không cần phát lại bài hiện tại
    if (choice === 'off') await queue.player.clearFilters();
    else await queue.player.setFilters(FILTERS[choice]);
    queue.filter = choice;

    const label = choice === 'off' ? 'Tắt hiệu ứng' : choice;
    return interaction.reply(`🎛️ Đã đổi hiệu ứng: **${label}**`);
  }

  if (commandName === 'playnext') {
    const queue = getQueue(guild.id);
    if (!queue || queue.songs.length === 0) {
      return interaction.reply({ content: 'Hàng đợi đang trống.', flags: MessageFlags.Ephemeral });
    }
    // Vị trí 0 là bài đang phát; chỉ chọn được từ 1 trở đi
    const n = interaction.options.getInteger('so');
    const maxN = queue.songs.length - 1;
    if (maxN < 1) {
      return interaction.reply({ content: 'Hàng đợi chưa có bài nào đứng sau để chọn.', flags: MessageFlags.Ephemeral });
    }
    if (n < 1 || n > maxN) {
      return interaction.reply({ content: `Số không hợp lệ. Chọn từ 1 đến ${maxN} (xem số bằng /queue).`, flags: MessageFlags.Ephemeral });
    }
    // Lấy bài ở vị trí n, chèn lên ngay sau bài đang phát (vị trí 1)
    const [picked] = queue.songs.splice(n, 1);
    queue.songs.splice(1, 0, picked);
    return interaction.reply(`⏫ Sẽ phát kế tiếp: **${picked.title}**`);
  }

  if (commandName === 'leave') {
    const queue = getQueue(guild.id);
    if (!queue) {
      return interaction.reply({ content: 'Bot không ở trong kênh thoại nào.', flags: MessageFlags.Ephemeral });
    }
    await destroyQueue(guild.id);
    return interaction.reply('👋 Đã rời kênh thoại.');
  }
}

client.on('error', (err) => console.error('Client error:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Thiếu DISCORD_TOKEN trong file .env — không thể đăng nhập.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
