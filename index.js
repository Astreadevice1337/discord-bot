const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const http = require('http');

// 1. ОЖИВИТЕЛЬ ДЛЯ ХОСТИНГА (Чтобы бот не выключался)
http.createServer((req, res) => {
  res.write("Bot is online!");
  res.end();
}).listen(8080);

// 2. БЕЗОПАСНЫЙ ТОКЕН (Возьмет из настроек Render)
const TOKEN = process.env.DISCORD_TOKEN; 
const CLIENT_ID = "1498991210457600020";

// Твои настройки каналов[cite: 1]
const PANEL_CHANNEL_ID = "1498975930922831902";
const CATEGORY_ID = "1499368333667995658";
const TICKET_LOG_CHANNEL = "1499488050323918928";
const MUTE_LOG_CHANNEL = "1499491738971144333";

const TICKET_ROLES = ["1498983698857459722", "1498985024416911440", "1498983277216796813"];
const MUTE_ROLES = ["1498985773477920848", "1498985024416911440", "1498983277216796813", "1498983698857459722"];
const MAX_TICKETS = 25;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const activeTickets = new Map();
const transcripts = new Map();

function parseTime(time) {
  const num = parseInt(time);
  const unit = time.slice(-1);
  if (isNaN(num)) return null;
  switch (unit) {
    case "с": return num * 1000;
    case "м": return num * 60 * 1000;
    case "ч": return num * 60 * 60 * 1000;
    case "д": return num * 24 * 60 * 60 * 1000;
    case "н": return num * 7 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Выдать мут')
    .addUserOption(o => o.setName('игрок').setRequired(true))
    .addStringOption(o => o.setName('время').setRequired(true))
    .addStringOption(o => o.setName('причина').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут')
    .addUserOption(o => o.setName('игрок').setRequired(true))
    .addStringOption(o => o.setName('причина').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  } catch (e) { console.error(e); }
})();

client.once('ready', async () => {
  console.log(`Запущено как ${client.user.tag}`);
  try {
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setTitle("Набор в клан")
      .setDescription('Нажми "Подать заявку" чтобы открыть тикет')
      .setColor(0x5865F2);
    const btn = new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel('Подать заявку')
      .setStyle(ButtonStyle.Primary);
    await channel.send({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(btn)]
    });
  } catch (e) { console.error("Ошибка при отправке панели:", e); }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId === "create_ticket") {
      if (activeTickets.size >= MAX_TICKETS) return interaction.reply({ content: "Лимит 25", ephemeral: true });
      if (activeTickets.has(interaction.user.id)) return interaction.reply({ content: "У тебя уже есть тикет", ephemeral: true });
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
          ...TICKET_ROLES.map(r => ({ id: r, allow: [PermissionsBitField.Flags.ViewChannel] }))
        ]
      });
      activeTickets.set(interaction.user.id, channel.id);
      const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Закрыть').setStyle(ButtonStyle.Danger);
      await channel.send({
        content: `# Заполни анкету\n1. Ник\n2. Устройство\n3. Возраст\n4. PVE/PVP\n5. Почему к нам`,
        components: [new ActionRowBuilder().addComponents(closeBtn)]
      });
      await interaction.reply({ content: "Тикет создан", ephemeral: true });
    }
    if (interaction.customId === "close_ticket") {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const logText = messages.reverse().map(m => `${m.author.tag}: ${m.content}`).join("\n");
      transcripts.set(interaction.channel.id, logText);
      const logChannel = await interaction.guild.channels.fetch(TICKET_LOG_CHANNEL);
      const checkBtn = new ButtonBuilder().setCustomId(`check_${interaction.channel.id}`).setLabel('Проверить').setStyle(ButtonStyle.Secondary);
      const logMsg = await logChannel.send({
        content: `Тикет закрыт: ${interaction.channel.name}`,
        components: [new ActionRowBuilder().addComponents(checkBtn)]
      });
      setTimeout(() => {
        transcripts.delete(interaction.channel.id);
        logMsg.delete().catch(() => {});
      }, 7 * 24 * 60 * 60 * 1000);
      await interaction.channel.delete();
    }
    if (interaction.customId.startsWith("check_")) {
      const id = interaction.customId.split("_")[1];
      const data = transcripts.get(id);
      if (!data) return interaction.reply({ content: "Лог удалён", ephemeral: true });
      await interaction.reply({ content: "```" + data.slice(0, 4000) + "```", ephemeral: true });
    }
  }
  if (!interaction.isChatInputCommand()) return;
  const member = interaction.member;
  if (!MUTE_ROLES.some(r => member.roles.cache.has(r))) return interaction.reply({ content: "Нет прав", ephemeral: true });
  if (interaction.commandName === "mute") {
    const target = interaction.options.getMember('игрок');
    const time = interaction.options.getString('время');
    const reason = interaction.options.getString('причина');
    const duration = parseTime(time);
    if (!duration) return interaction.reply({ content: "Неверный формат времени", ephemeral: true });
    if (member.roles.highest.position <= target.roles.highest.position) return interaction.reply({ content: "Нельзя мутить выше", ephemeral: true });
    await target.timeout(duration);
    const log = await interaction.guild.channels.fetch(MUTE_LOG_CHANNEL);
    log.send(`Мут: ${target.user.tag} на ${time} | ${reason}`);
    await interaction.reply({ content: "Мут выдан", ephemeral: true });
  }
  if (interaction.commandName === "unmute") {
    const target = interaction.options.getMember('игрок');
    await target.timeout(null);
    await interaction.reply({ content: "Размут", ephemeral: true });
  }
});

client.login(TOKEN);
