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
  SlashCommandBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle 
} = require('discord.js');
const http = require('http');

// Сервер для Render (чтобы не было ошибки портов)
const port = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
}).listen(port);

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = "1498991210457600020";

// 📌 Настройки ID
const PANEL_CHANNEL = "1498975930922831902";
const CATEGORY_ID = "1499368333667995658";
const TICKET_LOG = "1499488050323918928";
const MUTE_LOG = "1499491738971144333";

// 👮 Роли (по порядку иерархии сверху вниз)
const HIERARCHY = [
  "1498983277216796813", // 1. Самая высокая
  "1498983698857459722", // 2.
  "1498985024416911440", // 3.
  "1498985773477920848"  // 4. Самая низкая
];

// Роли, которые видят тикеты и могут юзать /clear
const STAFF_ROLES = ["1498985024416911440", "1498983698857459722", "1498983277216796813"];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const activeTickets = new Map();

// Создание белого Embed
const whiteEmbed = (text) => new EmbedBuilder().setDescription(text).setColor(0xFFFFFF);

// Авто-удаление ответов
async function replyAutoDelete(interaction, text, ephemeral = false) {
  const msg = await interaction.reply({ embeds: [whiteEmbed(text)], ephemeral, fetchReply: true });
  if (!ephemeral) setTimeout(() => msg.delete().catch(() => {}), 5000);
}

// Парсинг времени мута
function parseTime(timeStr) {
  const units = { 's': 1000, 'm': 60000, 'h': 3600000, 'd': 86400000, 'w': 604800000 };
  const match = timeStr.match(/^(\d+)([smhdw])$/);
  if (!match) return null;
  return parseInt(match[1]) * units[match[2]];
}

// Регистрация команд
const commands = [
  new SlashCommandBuilder().setName('mute').setDescription('Выдать тайм-аут')
    .addUserOption(o => o.setName('игрок').setDescription('Пользователь для мута').setRequired(true))
    .addStringOption(o => o.setName('время').setDescription('Время (s, m, h, d, w)').setRequired(true))
    .addStringOption(o => o.setName('причина').setDescription('Причина мута').setRequired(true)),
  new SlashCommandBuilder().setName('unmute').setDescription('Снять тайм-аут')
    .addUserOption(o => o.setName('игрок').setDescription('Пользователь для размута').setRequired(true))
    .addStringOption(o => o.setName('причина').setDescription('Причина снятия мута').setRequired(true)),
  new SlashCommandBuilder().setName('clear').setDescription('Очистить чат')
    .addIntegerOption(o => o.setName('количество').setDescription('Количество сообщений').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
})();

client.once('ready', async () => {
  console.log(`Bot Ready: ${client.user.tag}`);
  const ch = await client.channels.fetch(PANEL_CHANNEL);
  const btn = new ButtonBuilder().setCustomId('create_ticket').setLabel('Подать Заявку').setStyle(ButtonStyle.Primary);
  
  // Проверка, чтобы не дублировать панель
  const msgs = await ch.messages.fetch({ limit: 10 });
  if (!msgs.some(m => m.embeds[0]?.description?.includes("Набор в клан"))) {
    await ch.send({
      embeds: [whiteEmbed("Набор в клан\nНажми \"Подать Заявку\" что-бы подать заявку в наши ряды")],
      components: [new ActionRowBuilder().addComponents(btn)]
    });
  }
});

client.on(Events.InteractionCreate, async interaction => {
  // --- ЛОГИКА ТИКЕТОВ ---
  if (interaction.isButton()) {
    if (interaction.customId === 'create_ticket') {
      if (activeTickets.size >= 25) return replyAutoDelete(interaction, "Лимит тикетов (25) исчерпан.", true);
      if ([...activeTickets.values()].some(t => t.owner === interaction.user.id)) return replyAutoDelete(interaction, "У вас уже есть открытый тикет.", true);

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
          ...STAFF_ROLES.map(id => ({ id, allow: [PermissionsBitField.Flags.ViewChannel] }))
        ]
      });

      activeTickets.set(channel.id, { owner: interaction.user.id });
      
      const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Закрыть').setStyle(ButtonStyle.Danger);
      await channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [whiteEmbed("Заполните заявку ниже\n\n1. Ваш ник в игре\n\n2. Ваше устройство\n\n3. Ваш возраст\n\n4. Ваша оценка ПВП 0/10\n\n5. Готовы ли вы вылетать на кв\n\n6. В каких кланах состояли до этого")],
        components: [new ActionRowBuilder().addComponents(closeBtn)]
      });

      await interaction.reply({ embeds: [whiteEmbed(`Тикет успешно создан: ${channel}`)], ephemeral: true });
    }

    if (interaction.customId === 'close_ticket') {
      const modal = new ModalBuilder().setCustomId('close_modal').setTitle('Причина закрытия');
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
  }

  // --- МОДАЛКА ЗАКРЫТИЯ ---
  if (interaction.isModalSubmit() && interaction.customId === 'close_modal') {
    const reason = interaction.fields.getTextInputValue('reason');
    const logCh = await interaction.guild.channels.fetch(TICKET_LOG);
    const ticketData = activeTickets.get(interaction.channelId);

    await logCh.send({ embeds: [whiteEmbed(`**Лог Тикета**\nЗакрыл: ${interaction.user.tag}\nВладелец: <@${ticketData?.owner}>\nПричина: ${reason}`)] });
    activeTickets.delete(interaction.channelId);
    await interaction.reply({ embeds: [whiteEmbed("Тикет будет удален через 3 секунды...")] });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
  }

  // --- КОМАНДЫ ---
  if (!interaction.isChatInputCommand()) return;

  const getRoleLevel = (member) => {
    for (let i = 0; i < HIERARCHY.length; i++) {
      if (member.roles.cache.has(HIERARCHY[i])) return i;
    }
    return 999;
  };

  const executorLevel = getRoleLevel(interaction.member);

  if (interaction.commandName === 'mute') {
    const target = interaction.options.getMember('игрок');
    const timeStr = interaction.options.getString('время');
    const reason = interaction.options.getString('причина');
    const duration = parseTime(timeStr);

    if (executorLevel > 3) return replyAutoDelete(interaction, "У вас нет прав для мута.");
    if (!target) return replyAutoDelete(interaction, "Игрок не найден.");
    if (getRoleLevel(target) <= executorLevel) return replyAutoDelete(interaction, "Вы не можете мутить игрока с равной или более высокой ролью.");
    if (!duration) return replyAutoDelete(interaction, "Неверный формат времени (пример: 10m, 1h).");

    await target.timeout(duration, reason);
    const logCh = await interaction.guild.channels.fetch(MUTE_LOG);
    await logCh.send({ embeds: [whiteEmbed(`Сотрудник ${interaction.user.tag} замутил игрока ${target.user.tag} на ${timeStr} причина: ${reason}`)] });
    await replyAutoDelete(interaction, `Успешно: ${target.user.tag} в муте на ${timeStr}.`);
  }

  if (interaction.commandName === 'unmute') {
    const target = interaction.options.getMember('игрок');
    const reason = interaction.options.getString('причина');

    if (executorLevel > 3) return replyAutoDelete(interaction, "У вас нет прав.");
    if (!target) return replyAutoDelete(interaction, "Игрок не найден.");

    await target.timeout(null, reason);
    const logCh = await interaction.guild.channels.fetch(MUTE_LOG);
    await logCh.send({ embeds: [whiteEmbed(`Сотрудник ${interaction.user.tag} снял мут с игрока ${target.user.tag} причина: ${reason}`)] });
    await replyAutoDelete(interaction, `Успешно: Мут с ${target.user.tag} снят.`);
  }

  if (interaction.commandName === 'clear') {
    if (!STAFF_ROLES.some(id => interaction.member.roles.cache.has(id))) return replyAutoDelete(interaction, "У вас нет прав.");
    let amount = interaction.options.getInteger('количество');
    if (amount > 1000) amount = 1000;

    await interaction.channel.bulkDelete(amount, true);
    await replyAutoDelete(interaction, `Чат очищен на ${amount} сообщений.`);
  }
});

client.login(TOKEN);
