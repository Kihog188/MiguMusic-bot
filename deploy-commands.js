// deploy-commands.js
// Chạy file này MỖI KHI bạn thêm/sửa lệnh mới: node deploy-commands.js
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Phát nhạc từ link YouTube (hoặc từ khoá tìm kiếm)')
    .addStringOption(option =>
      option.setName('link')
        .setDescription('Link YouTube hoặc từ khoá tìm bài hát')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Bỏ qua bài hát đang phát'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Dừng nhạc và xoá hàng đợi'),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Tạm dừng bài hát'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Tiếp tục phát bài hát'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Xem danh sách hàng đợi hiện tại'),

  new SlashCommandBuilder()
    .setName('playnext')
    .setDescription('Đưa một bài trong hàng đợi lên phát kế tiếp')
    .addIntegerOption(option =>
      option.setName('so')
        .setDescription('Số thứ tự bài trong /queue (từ 1 trở đi)')
        .setRequired(true)
        .setMinValue(1)),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Xem bài đang phát'),

  new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Đổi hiệu ứng âm thanh (bassboost, nightcore, 8D...)')
    .addStringOption(option =>
      option.setName('loai')
        .setDescription('Loại hiệu ứng')
        .setRequired(true)
        .addChoices(
          { name: 'Tắt (gốc)', value: 'off' },
          { name: 'Bass Boost', value: 'bassboost' },
          { name: 'Nightcore', value: 'nightcore' },
          { name: '8D', value: '8d' },
          { name: 'Treble', value: 'treble' },
          { name: 'Vaporwave (slowed)', value: 'vaporwave' },
        )),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Cho bot rời khỏi kênh thoại'),
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Đang đăng ký slash commands...');

    if (process.env.GUILD_ID) {
      // Đăng ký cho 1 server cụ thể -> cập nhật gần như ngay lập tức (dùng để test)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands },
      );
      console.log('Đã đăng ký lệnh cho server test thành công!');
    } else {
      // Đăng ký toàn cục -> có thể mất tới 1 giờ để cập nhật trên mọi server
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
      );
      console.log('Đã đăng ký lệnh toàn cục thành công!');
    }
  } catch (error) {
    console.error(error);
  }
})();
