require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  Events,
} = require('discord.js');

const translate = require('translate-google');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const EXCLUDED_CHANNEL_IDS = (process.env.EXCLUDED_CHANNEL_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const translationCache = new Map();

const LANGUAGES = {
  fr: { label: 'Français', emoji: '🇫🇷' },
  en: { label: 'English', emoji: '🇬🇧' },
  de: { label: 'Deutsch', emoji: '🇩🇪' },
  it: { label: 'Italiano', emoji: '🇮🇹' },
  es: { label: 'Español', emoji: '🇪🇸' },
  pt: { label: 'Português', emoji: '🇵🇹' },
  pl: { label: 'Polski', emoji: '🇵🇱' },
  ru: { label: 'Русский', emoji: '🇷🇺' },
};

function buildTranslateButton(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`open_translate_menu:${messageId}`)
      .setLabel('Traduire')
      .setEmoji('🌍')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildLanguageMenu(messageId) {
  const options = Object.entries(LANGUAGES).map(([code, lang]) => ({
    label: lang.label,
    value: `translate:${messageId}:${code}`,
    emoji: lang.emoji,
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`language_select:${messageId}`)
      .setPlaceholder('Choisissez une langue')
      .addOptions(options)
  );
}

async function translateText(originalText, targetLanguageCode) {
  const translated = await translate(originalText, {
    to: targetLanguageCode,
  });

  if (!translated || !translated.trim()) {
    throw new Error('Traduction vide');
  }

  return translated.trim();
}

async function getOrCreateTranslation(messageId, originalText, languageCode) {
  if (!translationCache.has(messageId)) {
    translationCache.set(messageId, {
      originalText,
      translations: {},
    });
  }

  const entry = translationCache.get(messageId);

  if (entry.translations[languageCode]) {
    return entry.translations[languageCode];
  }

  const translated = await translateText(originalText, languageCode);
  entry.translations[languageCode] = translated;
  return translated;
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content?.trim()) return;
    if (message.content.length < 2) return;
    if (EXCLUDED_CHANNEL_IDS.includes(message.channel.id)) return;

    const row = buildTranslateButton(message.id);

    await message.reply({
      content: '🌍 **Traduction disponible**',
      components: [row],
    });

    translationCache.set(message.id, {
      originalText: message.content,
      translations: {},
    });
  } catch (error) {
    console.error('Erreur bouton traduire :', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton()) {
      if (!interaction.customId.startsWith('open_translate_menu:')) return;

      const [, messageId] = interaction.customId.split(':');

      await interaction.reply({
        content: 'Choisissez la langue de traduction :',
        components: [buildLanguageMenu(messageId)],
        ephemeral: true,
      });

      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (!interaction.customId.startsWith('language_select:')) return;

      const selected = interaction.values[0];
      const [, messageId, languageCode] = selected.split(':');

      const sourceMessage = await interaction.channel.messages.fetch(messageId);
      const originalText = sourceMessage?.content?.trim();

      if (!originalText) {
        await interaction.update({
          content: 'Impossible de lire le message source.',
          components: [],
        });
        return;
      }

      const translatedText = await getOrCreateTranslation(
        messageId,
        originalText,
        languageCode
      );

      const lang = LANGUAGES[languageCode];

      await interaction.update({
        content: `${lang.emoji} **${lang.label}**\n\n${translatedText}`,
        components: [],
      });

      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
        }
      }, 2 * 60 * 1000);

      return;
    }
  } catch (error) {
    console.error('Erreur interaction :', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: 'Une erreur est survenue pendant la traduction.',
          components: [],
        });
      } else {
        await interaction.reply({
          content: 'Une erreur est survenue pendant la traduction.',
          ephemeral: true,
        });
      }
    } catch (e) {
    }
  }
});

client.login(process.env.DISCORD_TOKEN);