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

function normalizeText(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectLanguageSimple(text) {
  const t = normalizeText(text).toLowerCase();

  if (!t) return null;

  // Russe
  if (/[а-яё]/i.test(t)) return 'ru';

  // Allemand
  if (/[äöüß]/i.test(t) || /\b(und|der|die|das|ist|nicht|hallo|danke)\b/i.test(t)) {
    return 'de';
  }

  // Italien
  if (/[àèéìòù]/i.test(t) || /\b(ciao|grazie|come|sono|perché|buongiorno)\b/i.test(t)) {
    return 'it';
  }

  // Espagnol
  if (/[ñ¿¡]/i.test(t) || /\b(hola|gracias|como|estás|para|buenos)\b/i.test(t)) {
    return 'es';
  }

  // Portugais
  if (/[ãõç]/i.test(t) || /\b(olá|obrigado|você|como|para|bom dia)\b/i.test(t)) {
    return 'pt';
  }

  // Polonais
  if (/[ąćęłńóśźż]/i.test(t) || /\b(cześć|dziękuję|jest|dzień|dobry)\b/i.test(t)) {
    return 'pl';
  }

  // Français
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(t) || /\b(bonjour|merci|salut|avec|pour|est|une|des)\b/i.test(t)) {
    return 'fr';
  }

  // Anglais
  if (/\b(hello|thanks|please|what|how|good|morning|everyone|guys)\b/i.test(t)) {
    return 'en';
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
      detectedLanguage: detectLanguageSimple(originalText),
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

function getDetectedLanguage(messageId, originalText) {
  if (!translationCache.has(messageId)) {
    translationCache.set(messageId, {
      originalText,
      translations: {},
      detectedLanguage: detectLanguageSimple(originalText),
    });
  }

  return translationCache.get(messageId).detectedLanguage || null;
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
      detectedLanguage: detectLanguageSimple(message.content),
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

    const detectedLanguage = getDetectedLanguage(messageId, originalText);

    if (detectedLanguage && detectedLanguage === userLanguage) {
      await interaction.reply({
        content: `ℹ️ Ce message semble déjà être en **${LANGUAGES[userLanguage].label}**.`,
        ephemeral: true,
      });

      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
        }
      }, 60 * 1000);

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