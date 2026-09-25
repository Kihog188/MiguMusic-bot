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
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const ytdlp = require('youtube-dl-exec');
const ytSearch = require('yt-search');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Các bộ lọc âm thanh (tham số -af của ffmpeg). key = giá trị chọn trong lệnh /filter
const FILTERS = {
  off: null,
  bassboost: 'bass=g=12',
  nightcore: 'asetrate=48000*1.25,aresample=48000',
  '8d': 'apulsator=hz=0.09',
  treble: 'treble=g=8',
  vaporwave: 'asetrate=48000*0.8,aresample=48000',
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// Lưu trữ hàng đợi (queue) cho mỗi server (guild), key = guildId
// queue = { connection, player, songs: [{title, url}], textChannel, playing: bool }
const queues = new Map();

function safeDestroy(connection) {
  try {
    if (!connection) return;
    const status = connection.state?.status;
    if (status !== VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    }
  } catch (err) {
    // ignore errors when destroying an already-destroyed connection
  }
}

// Kill một cặp tiến trình (yt-dlp + ffmpeg) cụ thể
function killProcs(proc, ffmpeg) {
  for (const p of [proc, ffmpeg]) {
    try {
      if (p && !p.killed) p.kill('SIGKILL');
    } catch (err) {
      // ignore
    }
  }
}

function killProcess(queue) {
  if (!queue) return;
  killProcs(queue.currentProcess, queue.currentFfmpeg);
  queue.currentProcess = null;
  queue.currentFfmpeg = null;
}

function isYoutubeUrl(text) {
  return /^https?:\/\/(www\.|music\.|m\.)?(youtube\.com|youtu\.be)\//i.test((text || '').trim());
}

// Tuỳ chọn chung cho mọi lần gọi yt-dlp.
// - jsRuntimes: dùng Node có sẵn để giải n-challenge của YouTube (không có sẽ bị 403 khi tải)
// - cookies: đặt YTDL_COOKIES=đường/dẫn/cookies.txt trong .env khi host bị YouTube chặn IP
//   (VPS/cloud). Chạy ở máy cá nhân thì không cần.
const YTDLP_BASE = {
  noWarnings: true,
  jsRuntimes: 'node',
  ...(process.env.YTDL_COOKIES ? { cookies: process.env.YTDL_COOKIES } : {}),
};

// Tìm bài hát từ từ khoá nếu không phải link
async function resolveSong(input) {
  if (isYoutubeUrl(input)) {
    const info = await ytdlp(input, {
      ...YTDLP_BASE,
      dumpSingleJson: true,
      noPlaylist: true,
      skipDownload: true,
    });
    return { title: info.title, url: info.webpage_url || input };
  } else {
    const result = await ytSearch(input);
    const video = result.videos[0];
    if (!video) return null;
    return { title: video.title, url: video.url };
  }
}

// Link có chứa list= -> là playlist
function isPlaylistUrl(text) {
  return /[?&]list=/.test((text || '').trim());
}

// Trả về { songs: [{title,url}], playlistTitle }. Luôn là mảng (1 hoặc nhiều bài).
async function resolveTracks(input) {
  // Nếu là link playlist -> lấy toàn bộ danh sách (flat playlist cho nhanh)
  if (isYoutubeUrl(input) && isPlaylistUrl(input)) {
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
        .slice(0, 100) // giới hạn 100 bài để tránh playlist quá lớn
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

  // Video đơn hoặc từ khoá tìm kiếm
  const song = await resolveSong(input);
  return { songs: song ? [song] : [], playlistTitle: null };
}

function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guildId, connection, textChannelId) {
  const player = createAudioPlayer();
  const queue = {
    connection,
    player,
    songs: [],
    textChannelId,
    playing: false,
    filter: 'off',
    currentProcess: null,
    currentFfmpeg: null,
  };
  queues.set(guildId, queue);

  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    // Bài trước phát xong (hoặc bị skip) -> dọn tiến trình cũ rồi phát bài tiếp theo
    killProcess(queue);
    queue.songs.shift();
    void playNext(guildId).catch((e) => console.error('playNext error:', e));
  });

  player.on('error', (error) => {
    // Khi player lỗi, nó sẽ tự chuyển sang trạng thái Idle -> handler Idle ở trên
    // sẽ lo việc shift() và phát bài tiếp theo. KHÔNG shift() ở đây để tránh
    // bỏ qua nhầm 1 bài (double-shift).
    console.error('Lỗi player:', error?.message || error);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      safeDestroy(connection);
      queues.delete(guildId);
    }
  });

  return queue;
}

async function playNext(guildId) {
  const queue = getQueue(guildId);
  if (!queue) return;

  const song = queue.songs[0];
  if (!song) {
    queue.playing = false;
    // Không còn bài nào -> để bot đứng yên trong kênh thoại (không tự leave)
    return;
  }

  // 1) yt-dlp xuất luồng audio gốc ra stdout
  const ytProcess = ytdlp.exec(
    song.url,
    {
      ...YTDLP_BASE,
      output: '-',
      format: 'bestaudio[ext=webm]/bestaudio',
      quiet: true,
      noPlaylist: true,
    },
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Tránh unhandled rejection khi tiến trình bị kill (skip/stop). Nếu yt-dlp tự lỗi
  // (403, video riêng tư, bị chặn IP...) thì in dòng lỗi cuối để không "im lặng".
  ytProcess.catch((err) => {
    if (err?.isTerminated || err?.signal) return;
    const lastLine = (err?.stderr || '').trim().split('\n').pop();
    console.error(`yt-dlp lỗi khi phát "${song.title}":`, lastLine || err?.shortMessage || err?.message);
  });

  // 2) ffmpeg nhận audio từ yt-dlp, áp bộ lọc (nếu có), xuất PCM 48kHz stereo.
  //    @discordjs/voice (opusscript) sẽ tự encode Opus và căn nhịp 20ms chính xác
  //    -> tránh lỗi phát nhanh/giật khi để ffmpeg tự đóng gói Ogg/Opus.
  const filterArg = FILTERS[queue.filter] || null;
  const ffmpegArgs = [
    '-i', 'pipe:0',
    ...(filterArg ? ['-af', filterArg] : []),
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ];
  const ffmpeg = spawn(ffmpegPath, ffmpegArgs, { stdio: ['pipe', 'pipe', 'ignore'] });

  // Nối yt-dlp -> ffmpeg, nuốt lỗi EPIPE khi một bên bị kill
  ytProcess.stdout.on('error', () => {});
  ffmpeg.stdin.on('error', () => {});
  ffmpeg.on('error', (err) => console.error('Lỗi ffmpeg:', err?.message || err));
  ytProcess.stdout.pipe(ffmpeg.stdin);

  // Lưu cả 2 tiến trình để kill khi /skip, /stop, /leave, /filter
  queue.currentProcess = ytProcess;
  queue.currentFfmpeg = ffmpeg;

  const stream = ffmpeg.stdout;
  stream.on('error', (err) => {
    console.error(`Lỗi stream khi phát "${song.title}":`, err?.message || err);
  });

  const resource = createAudioResource(stream, { inputType: StreamType.Raw });
  queue.player.play(resource);
  queue.playing = true;

  // Lấy channel từ id để đảm bảo object hợp lệ và có trong cache
  try {
    let textChannel = client.channels.cache.get(queue.textChannelId);
    if (!textChannel) {
      textChannel = await client.channels.fetch(queue.textChannelId);
    }
    if (textChannel && typeof textChannel.send === 'function') {
      await textChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x1DB954)
            .setDescription(`🎶 Đang phát: **${song.title}**`),
        ],
      });
    } else {
      console.warn('playNext: textChannel not sendable', queue.textChannelId);
    }
  } catch (err) {
    console.error('Không thể gửi thông báo vào channel:', err);
  }
}

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
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
      });

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20000);
      } catch (err) {
        safeDestroy(connection);
        return interaction.editReply('❌ Không thể kết nối vào kênh thoại.');
      }

      queue = createQueue(guild.id, connection, interaction.channelId);
    }

    const wasIdle = !queue.playing;
    for (const s of songs) queue.songs.push(s);

    if (wasIdle) playNext(guild.id);

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
    queue.player.stop(); // sẽ trigger 'Idle' -> tự phát bài tiếp theo
    return interaction.reply('⏭️ Đã bỏ qua bài hát.');
  }

  if (commandName === 'stop') {
    const queue = getQueue(guild.id);
    if (!queue) {
      return interaction.reply({ content: 'Bot không ở trong kênh thoại nào.', flags: MessageFlags.Ephemeral });
    }
    queue.songs = [];
    killProcess(queue);
    queue.player.stop();
    safeDestroy(queue.connection);
    queues.delete(guild.id);
    return interaction.reply('⏹️ Đã dừng nhạc và rời kênh thoại.');
  }

  if (commandName === 'pause') {
    const queue = getQueue(guild.id);
    if (!queue || !queue.playing) {
      return interaction.reply({ content: 'Không có bài nào đang phát.', flags: MessageFlags.Ephemeral });
    }
    queue.player.pause();
    return interaction.reply('⏸️ Đã tạm dừng.');
  }

  if (commandName === 'resume') {
    const queue = getQueue(guild.id);
    if (!queue) {
      return interaction.reply({ content: 'Không có bài nào đang chờ.', flags: MessageFlags.Ephemeral });
    }
    queue.player.unpause();
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

    queue.filter = choice;
    const label = choice === 'off' ? 'Tắt hiệu ứng' : choice;

    // Nếu đang phát -> phát lại bài hiện tại với hiệu ứng mới (bài sẽ bắt đầu lại từ đầu)
    if (queue.playing && queue.songs[0]) {
      // playNext() spawn yt-dlp + ffmpeg, có thể lâu hơn cửa sổ 3 giây của Discord
      // -> phải báo nhận trước, nếu không interaction hết hạn (lỗi 10062)
      await interaction.deferReply();
      const oldYt = queue.currentProcess;
      const oldFf = queue.currentFfmpeg;
      await playNext(guild.id); // player.play() thay resource mới -> không kích hoạt shift
      killProcs(oldYt, oldFf); // dọn tiến trình cũ sau khi đã chuyển sang resource mới
      return interaction.editReply(`🎛️ Đã đổi hiệu ứng: **${label}** — phát lại bài hiện tại.`);
    }
    return interaction.reply(`🎛️ Đã đặt hiệu ứng: **${label}** — áp dụng cho bài kế tiếp.`);
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
    killProcess(queue);
    safeDestroy(queue.connection);
    queues.delete(guild.id);
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
