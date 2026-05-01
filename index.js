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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = "1498991210457600020";

// 📌 ID
const PANEL_CHANNEL = "1498975930922831902";
const CATEGORY_ID = "1499368333667995658";
const LOG_CHANNEL = "1499488050323918928";

// 👮 роли
const STAFF_ROLES = [
  "1498985024416911440",
  "1498983698857459722",
  "1498983277216796813"
];

const MAX_TICKETS = 25;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const activeTickets = new Map();
const transcripts = new Map();

// embed
const embed = (text) =>
  new EmbedBuilder().setDescription(text).setColor(0xffffff);

// авто удаление
async function replyDelete(interaction, text) {
  const msg = await interaction.reply({
    embeds: [embed(text)],
    fetchReply: true
  });
  setTimeout(() => msg.delete().catch(() => {}), 5000);
}

// команды (ИСПРАВЛЕНО: Добавлены обязательные описания опций)
const commands = [
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Мут')
    .addUserOption(o => o.setName('игрок').setDescription('Игрок для мута').setRequired(true))
    .addStringOption(o => o.setName('время').setDescription('Время мута').setRequired(true))
    .addStringOption(o => o.setName('причина').setDescription('Причина мута').setRequired(true)),

  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Размут')
    .addUserOption(o => o.setName('игрок').setDescription('Игрок для размута').setRequired(true))
    .addStringOption(o => o.setName('причина').setDescription('Причина размута').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Очистить чат')
    .addIntegerOption(o => o.setName('количество').setDescription('Количество сообщений').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  } catch (e) {
    console.error(e);
  }
})();

// запуск
client.once('ready', async () => {
  const ch = await client.channels.fetch(PANEL_CHANNEL);

  const btn = new ButtonBuilder()
    .setCustomId('create_ticket')
    .setLabel('Подать Заявку')
    .setStyle(ButtonStyle.Primary);

  await ch.send({
    embeds: [embed("**Набор в клан**\nНажми \"Подать Заявку\" что-бы подать заявку")],
    components: [new ActionRowBuilder().addComponents(btn)]
  });
});

// логика
client.on(Events.InteractionCreate, async interaction => {

  // ================= ТИКЕТ =================
  if (interaction.isButton()) {

    if (interaction.customId === "create_ticket") {

      if (activeTickets.size >= MAX_TICKETS)
        return interaction.reply({ embeds:[embed("Лимит тикетов")], ephemeral:true });

      if (activeTickets.has(interaction.user.id))
        return interaction.reply({ embeds:[embed("У тебя уже есть тикет")], ephemeral:true });

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
          ...STAFF_ROLES.map(r => ({ id: r, allow: [PermissionsBitField.Flags.ViewChannel] }))
        ]
      });

      activeTickets.set(interaction.user.id, channel.id);

      const close = new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel('Закрыть')
        .setStyle(ButtonStyle.Danger);

      await channel.send({
        content:
`Заполните заявку ниже
1. Ник
2. Устройство
3. Возраст
4. ПВП 0/10
5. Готов ли на кв
6. Где был`,
        components:[new ActionRowBuilder().addComponents(close)]
      });

      await interaction.reply({ embeds:[embed("Тикет создан")], ephemeral:true });
    }

    if (interaction.customId === "close_ticket") {

      const modal = new ModalBuilder()
        .setCustomId('close_modal')
        .setTitle('Причина закрытия');

      const input = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Причина')
        .setStyle(TextInputStyle.Paragraph);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }

    if (interaction.customId.startsWith("check_")) {

      const id = interaction.customId.split("_")[1];
      const data = transcripts.get(id);

      if (!data)
        return interaction.reply({ embeds:[embed("Лог удалён")], ephemeral:true });

      return interaction.reply({
        embeds:[embed("```"+data.slice(0,4000)+"```")],
        ephemeral:true
      });
    }
  }

  // модалка
  if (interaction.isModalSubmit()) {

    if (interaction.customId === "close_modal") {

      const reason = interaction.fields.getTextInputValue('reason');
      const messages = await interaction.channel.messages.fetch({ limit:100 });

      const logText = messages.reverse().map(m=>`${m.author.tag}: ${m.content}`).join("\n");

      transcripts.set(interaction.channel.id, logText);

      const log = await interaction.guild.channels.fetch(LOG_CHANNEL);

      const btn = new ButtonBuilder()
        .setCustomId(`check_${interaction.channel.id}`)
        .setLabel('Проверить')
        .setStyle(ButtonStyle.Secondary);

      const msg = await log.send({
        embeds:[embed(`Тикет закрыт\nПричина: ${reason}`)],
        components:[new ActionRowBuilder().addComponents(btn)]
      });

      setTimeout(()=>{
        transcripts.delete(interaction.channel.id);
        msg.delete().catch(()=>{});
      }, 7*24*60*60*1000);

      for (let [u,c] of activeTickets)
        if (c === interaction.channel.id) activeTickets.delete(u);

      await interaction.reply({ embeds:[embed("Тикет закрыт")], ephemeral:true });
      await interaction.channel.delete();
    }
  }

  // ================= КОМАНДЫ =================
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  if (!STAFF_ROLES.some(r => member.roles.cache.has(r)))
    return replyDelete(interaction,"Нет прав");

  // clear
  if (interaction.commandName === "clear") {
    const amount = interaction.options.getInteger('количество');
    if (amount > 100) return replyDelete(interaction,"Максимум 100"); // bulkDelete работает до 100 сообщений

    await interaction.channel.bulkDelete(amount,true);
    return replyDelete(interaction,`Удалено ${amount}`);
  }

  // mute
  if (interaction.commandName === "mute") {

    const target = interaction.options.getMember('игрок');
    const time = interaction.options.getString('время');

    const num = parseInt(time);
    const unit = time.slice(-1);

    let ms = 0;
    if(unit==="м") ms=num*60000;
    if(unit==="ч") ms=num*3600000;
    if(unit==="д") ms=num*86400000;

    if (member.roles.highest.position <= target.roles.highest.position)
      return replyDelete(interaction,"Нельзя мутить выше");

    await target.timeout(ms);
    return replyDelete(interaction,"Мут выдан");
  }

  // unmute
  if (interaction.commandName === "unmute") {

    const target = interaction.options.getMember('игрок');
    await target.timeout(null);
    return replyDelete(interaction,"Мут снят");
  }

});

client.login(TOKEN);
