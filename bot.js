require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} = require('discord.js');

const translate = require('translate-google');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
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

const ROLE_TO_LANGUAGE = {
  [process.env.ROLE_FR]: 'fr',
  [process.env.ROLE_EN]: 'en',
  [process.env.ROLE_DE]: 'de',
  [process.env.ROLE_IT]: 'it',
  [process.env.ROLE_ES]: 'es',
  [process.env.ROLE_PT]: 'pt',
  [process.env.ROLE_PL]: 'pl',
  [process.env.ROLE_RU]: 'ru',
};

function buildTranslateButton(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`translate_auto:${messageId}`)
      .setLabel('Traduire')
      .setEmoji('🌍')
      .setStyle(ButtonStyle.Secondary)
  );
}

function getUserLanguage(member) {
  if (!member || !member.roles || !member.roles.cache) {
    return null;
  }

  for (const roleId of member.roles.cache.keys()) {
    if (ROLE_TO_LANGUAGE[roleId]) {
      return ROLE_TO_LANGUAGE[roleId];
    }
  }

  return null;
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
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('translate_auto:')) return;

    const [, messageId] = interaction.customId.split(':');

    const userLanguage = getUserLanguage(interaction.member);

    if (!userLanguage || !LANGUAGES[userLanguage]) {
      await interaction.reply({
        content:
          "❌ Aucune langue n'est définie sur ton profil. Choisis d'abord une langue dans le salon des rôles.",
        ephemeral: true,
      });
      return;
    }

    const sourceMessage = await interaction.channel.messages.fetch(messageId);
    const originalText = sourceMessage?.content?.trim();

    if (!originalText) {
      await interaction.reply({
        content: 'Impossible de lire le message source.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const translatedText = await getOrCreateTranslation(
      messageId,
      originalText,
      userLanguage
    );

    const lang = LANGUAGES[userLanguage];

    await interaction.editReply({
      content: `${lang.emoji} **${lang.label}**\n\n${translatedText}`,
    });

    setTimeout(async () => {
      try {
        await interaction.deleteReply();
      } catch (error) {
      }
    }, 2 * 60 * 1000);
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