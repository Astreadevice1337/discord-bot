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
    .addUserOption(o => o.setName('имя_игрока').setDescription('Кого мутим').setRequired(true))
    // Твоя новая детальная подсказка:
    .addStringOption(o => o.setName('время').setDescription('с-сек, м-мин, ч-час, д-день, н-нед (Пример: 10м)').setRequired(true))
    .addStringOption(o => o.setName('причина').setDescription('Причина наказания').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Снять мут с игрока')
    .addUserOption(o => o.setName('имя_игрока').setDescription('С кого снять мут').setRequired(true))
    .addStringOption(o => o.setName('причина').setDescription('Причина снятия').setRequired(true))
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
          .setColor(0xFFFFFF);
        const btn = new ButtonBuilder()
          .setCustomId('create_ticket')
          .setLabel('Подать заявку')
          .setStyle(ButtonStyle.Secondary);
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
      
      const ticketEmbed = new EmbedBuilder()
        .setTitle("Анкета на вступление")
        .setDescription(`Привет <@${interaction.user.id}>! Заполни анкету:\n\n1. Твой ник в игре\n2. Твой возраст\n3. Твоё устройство\n4. Оцени себя в ПВП 0/10\n5. Готов вылетать на кв?\n6. В каких кланах был до этого?`)
        .setColor(0xFFFFFF);

      await channel.send({
        embeds: [ticketEmbed],
        components: [new ActionRowBuilder().addComponents(closeBtn)]
      });
      await interaction.reply({ content: `Тикет создан: <#${channel.id}>`, ephemeral: true });
    }

    if (interaction.customId === "close_ticket") {
      const logChannel = await interaction.guild.channels.fetch(TICKET_LOG_CHANNEL);
      const closeLogEmbed = new EmbedBuilder()
        .setDescription(`📌 Тикет пользователя **${interaction.channel.name}** был закрыт модератором **${interaction.user.tag}**`)
        .setColor(0xFFFFFF);
      
      await logChannel.send({ embeds: [closeLogEmbed] });
      
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
      const target = interaction.options.getMember('имя_игрока');
      const time = interaction.options.getString('время');
      const reason = interaction.options.getString('причина');
      const duration = parseTime(time);

      if (!duration) return interaction.reply({ content: "Ошибка формата времени (пример: 10м, 1ч)", ephemeral: true });
      
      await target.timeout(duration, reason);
      const log = await interaction.guild.channels.fetch(MUTE_LOG_CHANNEL);
      
      const muteEmbed = new EmbedBuilder()
        .setTitle("🚫 Выдано ограничение")
        .addFields(
            { name: 'Игрок', value: `${target.user.tag}`, inline: true },
            { name: 'Срок', value: `${time}`, inline: true },
            { name: 'Причина', value: `${reason}` }
        )
        .setColor(0xFF0000)
        .setTimestamp();

      await log.send({ embeds: [muteEmbed] });
      await interaction.reply({ embeds: [muteEmbed] });
    }

    if (interaction.commandName === "unmute") {
      const target = interaction.options.getMember('имя_игрока');
      const reason = interaction.options.getString('причина');
      await target.timeout(null);
      const log = await interaction.guild.channels.fetch(MUTE_LOG_CHANNEL);

      const unmuteEmbed = new EmbedBuilder()
        .setTitle("✅ Ограничение снято")
        .addFields(
            { name: 'Игрок', value: `${target.user.tag}`, inline: true },
            { name: 'Причина', value: `${reason}` }
        )
        .setColor(0x00FF00)
        .setTimestamp();

      await log.send({ embeds: [unmuteEmbed] });
      await interaction.reply({ embeds: [unmuteEmbed] });
    }
  }
});

client.login(TOKEN);
