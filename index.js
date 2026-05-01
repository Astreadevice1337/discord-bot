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

// Сервер для поддержания работы на Render
http.createServer((req, res) => {
  res.write("Bot is online!");
  res.end();
}).listen(8080);

const TOKEN = process.env.DISCORD_TOKEN; 
const CLIENT_ID = "1498991210457600020";

const PANEL_CHANNEL_ID = "1498975930922831902";
const CATEGORY_ID = "1499368333667995658";
const TICKET_LOG_CHANNEL = "1499488050323918928";
const MUTE_LOG_CHANNEL = "1499491738971144333";

const TICKET_ROLES = ["1498983698857459722", "1498985024416911440", "1498983277216796813"];
const MUTE_ROLES = ["1498985773477920848", "1498985024416911440", "1498983277216796813", "1498983698857459722"];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const activeTickets = new Map();

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
    .setDescription('Выдать мут игроку')
    .addUserOption(o => o.setName('target').setDescription('Кого мутим').setRequired(true))
    .addStringOption(o => o.setName('time').setDescription('На сколько (10м, 1ч)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Причина').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут с игрока')
    .addUserOption(o => o.setName('target').setDescription('С кого снять').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Причина').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
  console.log(`Запущено как ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    
    const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    const messages = await channel.messages.fetch({ limit: 10 });
    const botMsg = messages.find(m => m.author.id === client.user.id);
    
    if (!botMsg) {
        const embed = new EmbedBuilder()
          .setTitle("Набор в клан")
          .setDescription('Нажми кнопку ниже, чтобы подать заявку!')
          .setColor(0x5865F2);
        const btn = new ButtonBuilder()
          .setCustomId('create_ticket')
          .setLabel('Подать заявку')
          .setStyle(ButtonStyle.Primary);
        await channel.send({
          embeds: [embed],
          components: [new ActionRowBuilder().addComponents(btn)]
        });
    }
  } catch (e) { console.error(e); }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton()) {
    if (interaction.customId === "create_ticket") {
      if (activeTickets.has(interaction.user.id)) return interaction.reply({ content: "У тебя уже есть открытый тикет!", ephemeral: true });
      
      const channel = await interaction.guild.channels.create({
        name: `заявка-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
          ...TICKET_ROLES.map(r => ({ id: r, allow: [PermissionsBitField.Flags.ViewChannel] }))
        ]
      });
      
      activeTickets.set(interaction.user.id, channel.id);
      const closeBtn = new ButtonBuilder().setCustomId('close_ticket').setLabel('Закрыть тикет').setStyle(ButtonStyle.Danger);
      
      await channel.send({
        content: `Привет <@${interaction.user.id}>! Заполни анкету:
1. Твой ник в игре
2. Твой возраст
3. Твоё устройство
4. Оцени себя в ПВП 0/10
5. Готов вылетать на кв?
6. В каких кланах был до этого?`,
        components: [new ActionRowBuilder().addComponents(closeBtn)]
      });
      await interaction.reply({ content: `Тикет создан: <#${channel.id}>`, ephemeral: true });
    }

    if (interaction.customId === "close_ticket") {
      const logChannel = await interaction.guild.channels.fetch(TICKET_LOG_CHANNEL);
      await logChannel.send(`Тикет пользователя ${interaction.channel.name} был закрыт.`);
      
      for (const [userId, channelId] of activeTickets.entries()) {
          if (channelId === interaction.channel.id) activeTickets.delete(userId);
      }
      await interaction.channel.delete();
    }
  }

  if (interaction.isChatInputCommand()) {
    const member = interaction.member;
    if (!MUTE_ROLES.some(r => member.roles.cache.has(r))) return interaction.reply({ content: "У тебя нет прав!", ephemeral: true });

    if (interaction.commandName === "mute") {
      const target = interaction.options.getMember('target');
      const time = interaction.options.getString('time');
      const reason = interaction.options.getString('reason');
      const duration = parseTime(time);

      if (!duration) return interaction.reply({ content: "Ошибка формата времени (пример: 10м, 1ч)", ephemeral: true });
      
      await target.timeout(duration, reason);
      const log = await interaction.guild.channels.fetch(MUTE_LOG_CHANNEL);
      
      const muteText = `🔇 **Игрок ${target.user.tag} был замучен на ${time}. Причина: ${reason}**`;
      log.send(muteText);
      await interaction.reply({ content: muteText });
    }

    if (interaction.commandName === "unmute") {
      const target = interaction.options.getMember('target');
      const reason = interaction.options.getString('reason');
      await target.timeout(null);
      const log = await interaction.guild.channels.fetch(MUTE_LOG_CHANNEL);

      const unmuteText = `🔊 **С игрока ${target.user.tag} был снят мут. Причина: ${reason}**`;
      log.send(unmuteText);
      await interaction.reply({ content: unmuteText });
    }
  }
});

client.login(TOKEN);
