import "dotenv/config";
import { readFile, writeFile } from "fs/promises";
import { Telegraf, Markup } from "telegraf";
import nodemailer from "nodemailer";
import dayjs from "dayjs";
import LocalSession from "telegraf-session-local";
import "dayjs/locale/ru.js";
dayjs.locale("ru");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const SUBSCRIBERS_FILE = new URL("./subscribers.json", import.meta.url);
const SENT_VACANCIES_FILE = new URL("./sentVacancies.json", import.meta.url);

// Добавляем константы для ID таблиц городов
const SHEETS_MAPPING = {
  msk: process.env.SHITS_MSK_ID,
  spb: process.env.SHITS_SPB_ID,
  remote: process.env.SHITS_REM_ID,
};

console.log("SHEETS_MAPPING loaded:", {
  msk: process.env.SHITS_MSK_ID ? "✓" : "✗",
  spb: process.env.SHITS_SPB_ID ? "✓" : "✗",
  remote: process.env.SHITS_REM_ID ? "✓" : "✗",
});

const NOTIFY_CHAT_IDS = process.env.NOTIFY_CHAT_IDS
  ? process.env.NOTIFY_CHAT_IDS.split(",").map((id) => id.trim()).filter(Boolean)
  : [];
const EMAIL_NOTIFY_TO = process.env.EMAIL_NOTIFY_TO
  ? process.env.EMAIL_NOTIFY_TO.split(",").map((email) => email.trim()).filter(Boolean)
  : [];
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const emailTransporter = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT || 587,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

function isTelegramId(value) {
  return /^-?\d+$/.test(String(value));
}

async function resolveTelegramTarget(value) {
  if (!value) return null;
  if (isTelegramId(value)) return value;

  const username = value.startsWith("@") ? value : `@${value}`;
  try {
    const chat = await bot.telegram.getChat(username);
    return chat.id;
  } catch (err) {
    console.error("Ошибка разрешения Telegram username:", value, err.message);
    return null;
  }
}

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN не задан. Установите переменную окружения BOT_TOKEN в .env или окружении.");
}

const mainKeyboard = Markup.keyboard([["💼 Вакансии"]]).resize().oneTime(false);
const bot = new Telegraf(BOT_TOKEN);

async function loadJson(file, defaultValue) {
  try {
    const content = await readFile(file, "utf8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") return defaultValue;
    throw err;
  }
}

async function saveJson(file, data) {
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function getSubscribers() {
  return await loadJson(SUBSCRIBERS_FILE, []);
}

async function addSubscriber(chatId) {
  const subscribers = await getSubscribers();
  if (!subscribers.includes(chatId)) {
    subscribers.push(chatId);
    await saveJson(SUBSCRIBERS_FILE, subscribers);
  }
}

async function getSentVacancies() {
  return await loadJson(SENT_VACANCIES_FILE, []);
}

async function addSentVacancy(id) {
  const sent = await getSentVacancies();
  if (!sent.includes(id)) {
    sent.push(id);
    await saveJson(SENT_VACANCIES_FILE, sent);
  }
}

function scriptRequestUrl(action, params = {}) {
  if (!SCRIPT_URL) {
    throw new Error("SCRIPT_URL не задан");
  }

  const url = new URL(SCRIPT_URL);
  url.searchParams.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value != null) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

async function parseJsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON response from Apps Script: ${text.slice(0, 1000)}`);
  }
}

async function apiGet(action) {
  const response = await fetch(scriptRequestUrl(action));
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apps Script GET failed ${response.status}: ${body}`);
  }
  const body = await parseJsonOrText(response);
  if (body.success === false) throw new Error(body.error || "Unknown Apps Script error");
  return body.data ?? body;
}

async function apiPost(action, payload) {
  const response = await fetch(scriptRequestUrl(action), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Apps Script POST failed ${response.status}: ${body}`);
  }
  const body = await parseJsonOrText(response);
  if (body.success === false) throw new Error(body.error || "Unknown Apps Script error");
  return body.data ?? body;
}

async function saveRecommendation(vacancyTitle, username, name, recommendedUsername, sheetId) {
  await apiPost("saveRecommendation", {
    vacancyTitle,
    username,
    name,
    recommendedUsername,
    sheetId,
  });
}

async function sendNewVacancy(vacancy) {
  const subscribers = await getSubscribers();
  if (!subscribers.length) return;

  const photoUrl = vacancy.photo || "https://picsum.photos/600/200";
  const publishDate = formatPublishDate(vacancy.publishDate) || "не указано";
  const caption = `💼 *${escapeMarkdownV2(vacancy.title)}*\n📍 ${escapeMarkdownV2(vacancy.city)}\n🗓 Опубликовано: ${escapeMarkdownV2(publishDate)}\n\n${escapeMarkdownV2(vacancy.description || "Без описания")}`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "📎 Откликнуться", callback_data: `job_${vacancy.id}` },
        { text: "ℹ️ Подробнее", url: vacancy.telegraLink || "https://telegra.ph/" },
      ],
    ],
  };

  await Promise.all(subscribers.map(async (chatId) => {
    try {
      await bot.telegram.sendPhoto(chatId, photoUrl, {
        caption,
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error("Ошибка отправки новой вакансии подписчику", chatId, err.message);
    }
  }));
}

async function checkForNewVacancies() {
  try {
    const vacancies = await getVacancies(sheetId);
    const sent = await getSentVacancies();
    const newVacancies = vacancies.filter(v => v.id && !sent.includes(v.id));
    for (const vacancy of newVacancies) {
      await sendNewVacancy(vacancy);
      await addSentVacancy(vacancy.id);
    }
  } catch (err) {
    console.error("Ошибка при проверке новых вакансий:", err.message);
  }
}

const localSession = new LocalSession({
  database: "sessions.json",
  property: "session",
});
bot.use(localSession.middleware());

function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.replace(/([_\*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function formatPublishDate(raw) {
  if (!raw) return "";

  let date = dayjs(raw, ["YYYY-MM-DD", "DD.MM.YYYY"], true);
  if (date.isValid()) return date.format("D MMMM YYYY");

  if (!isNaN(raw)) {
    date = dayjs("1899-12-30").add(Number(raw), "day");
    if (date.isValid()) return date.format("D MMMM YYYY");
  }

  return String(raw);
}

function buildViewerLink(url) {
  if (!url) return "";
  try {
    return new URL(String(url).trim()).toString();
  } catch {
    return String(url).trim();
  }
}

async function getVacancies(sheetId) {
  const url = scriptRequestUrl("getVacancies", { sheetId });
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();

  if (body?.success === false) {
    throw new Error(body.error || "API returned error");
  }

  if (Array.isArray(body?.data)) {
    return body.data;
  }

  if (Array.isArray(body)) {
    return body;
  }

  return [];
}

bot.start(async (ctx) => {
  await addSubscriber(ctx.chat.id);
  return ctx.reply(
    "👋 Привет! Я бот с вакансиями.\n\nЧтобы получать уведомления, напишите /myid и используйте этот chat_id в NOTIFY_CHAT_IDS.",
    mainKeyboard
  );
});

bot.command("myid", async (ctx) => {
  return ctx.reply(`Ваш chat_id: ${ctx.chat.id}`);
});

bot.hears(/Вакансии/i, async (ctx) => {
  await ctx.reply(
    "Выберите город:",
    Markup.inlineKeyboard([
      [
        { text: "🏙️ Москва", callback_data: "city_msk" },
        { text: "🌉 Санкт-Петербург", callback_data: "city_spb" },
      ],
      [
        { text: "💻 Удаленно", callback_data: "city_remote" },
      ]
    ])
  );
});

bot.action(/city_(msk|spb|remote)/, async (ctx) => {
  const city = ctx.match[1];
  const cityNames = { msk: "Москва", spb: "Санкт-Петербург", remote: "Удаленно" };
  const sheetId = SHEETS_MAPPING[city];

  console.log(`[city_${city}] SheetId:`, sheetId);

  if (!sheetId) {
    console.error(`❌ SheetId не найден для города ${city}`);
    return ctx.reply(`❌ Конфигурация города ${city} не найдена. SheetId: ${sheetId}`, mainKeyboard);
  }

  try {
    const url = `${SCRIPT_URL}?action=getVacancies&sheetId=${encodeURIComponent(sheetId)}`;
    console.log("API URL:", url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const body = await response.json();
    console.log("API response:", JSON.stringify(body).substring(0, 200));
    
    if (body.error) {
      throw new Error(body.error);
    }
    
    const vacancies = Array.isArray(body) ? body : (body.data || []);
    
    if (!vacancies.length) {
      return ctx.reply(`Пока нет активных вакансий в ${cityNames[city]} 🙈`, mainKeyboard);
    }

    const buttons = vacancies.map((v) => [
      Markup.button.callback(`${v.title}`, `job_${city}_${v.id}`)
    ]);

    await ctx.reply(
      `📋 Вакансии в ${cityNames[city]}:`,
      Markup.inlineKeyboard(buttons, { columns: 1 })
    );
  } catch (err) {
    console.error(`❌ Ошибка для ${city}:`, err.message);
    ctx.reply(`❌ Ошибка: ${err.message}`, mainKeyboard);
  }
});

bot.action(/^job_(msk|spb|remote)_(.+)$/, async (ctx) => {
  const city = ctx.match[1];
  const vid = ctx.match[2];
  const sheetId = SHEETS_MAPPING[city];

  if (!sheetId) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  const vacancies = await getVacancies(sheetId);
  const v = vacancies.find((vacancy) => vacancy.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  const buttons = [
    [
      { text: "📎 Откликнуться", callback_data: `apply_${city}_${v.id}` },
      { text: "🤝 Посоветовать", callback_data: `recommend_${city}_${v.id}` },
    ],
  ];

  if (v.telegraLink) {
    buttons.push([{ text: "ℹ️ Подробнее", url: v.telegraLink }]);
  }

  const caption = `💼 *${escapeMarkdownV2(v.title)}*\n📍 ${escapeMarkdownV2(v.city || cityNames[city])}\n🗓 ${escapeMarkdownV2(formatPublishDate(v.publishDate) || "не указано")}`;

  if (v.photo) {
    await ctx.replyWithPhoto(v.photo, {
      caption,
      parse_mode: "MarkdownV2",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  } else {
    await ctx.reply(caption, {
      parse_mode: "MarkdownV2",
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
    });
  }
});

bot.action(/^apply_(msk|spb|remote)_(.+)$/, async (ctx) => {
  const city = ctx.match[1];
  const vid = ctx.match[2];
  const sheetId = SHEETS_MAPPING[city];

  if (!sheetId) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  const vacancies = await getVacancies(sheetId);
  const v = vacancies.find((vacancy) => vacancy.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  ctx.session = ctx.session || {};
  ctx.session.apply = {
    step: 1,
    vacancy: v.title,
    sheetId,
    data: {},
  };

  await ctx.reply("1️⃣ Укажите ФИО.", mainKeyboard);
});

bot.action(/^recommend_(msk|spb|remote)_(.+)$/, async (ctx) => {
  const city = ctx.match[1];
  const vid = ctx.match[2];
  const sheetId = SHEETS_MAPPING[city];

  if (!sheetId) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  const vacancies = await getVacancies(sheetId);
  const v = vacancies.find((vacancy) => vacancy.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  ctx.session = ctx.session || {};
  ctx.session.recommendFor = {
    title: v.title,
    sheetId,
  };

  const message = `Отлично! 🙌 Пришли Telegram того человека, которого хочешь посоветовать для вакансии *${v.title}*.`;
  await ctx.reply(escapeMarkdownV2(message), { ...mainKeyboard, parse_mode: "MarkdownV2" });
});

bot.on("document", async (ctx) => {
  const s = ctx.session.apply;
  if (!s || s.step !== 6) return;

  const file = ctx.message.document;
  const user = ctx.from;

  try {
    const fileInfo = await ctx.telegram.getFile(file.file_id);
    const rawLink = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
    s.data.cv = buildViewerLink(rawLink);

    await finishApply(ctx);
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Ошибка при получении файла");
  }
});

bot.action(/night_(yes|no)/, async (ctx) => {
  const s = ctx.session.apply;
  if (!s) return;

  s.data.night = ctx.match[1] === "yes" ? "Готов" : "Не готов";
  s.step = 6;

  await ctx.reply("6️⃣ Отправьте своё резюме файлом pdf или приложите ссылку");
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text?.trim();
  const user = ctx.from;

  // ===== FLOW ОТКЛИКА =====
  if (ctx.session?.apply) {
    const s = ctx.session.apply;

    switch (s.step) {
      case 1:
        s.data.name = text;
        s.step = 2;
        return ctx.reply("2️⃣ Укажите полную дату рождения");

      case 2:
        s.data.birth = text;
        s.step = 3;
        return ctx.reply("3️⃣ Укажите номер телефона для связи и электронную почту");

      case 3:
        s.data.contacts = text;
        s.step = 4;
        return ctx.reply("4️⃣ Знание английского языка (желательно уровень)");

      case 4:
        s.data.english = text;
        s.step = 5;
        return ctx.reply(
          "5️⃣ Отношение к ночным сменам",
          Markup.inlineKeyboard([
            [
              { text: "👍 Готов", callback_data: "night_yes" },
              { text: "👎 Не готов", callback_data: "night_no" }
            ]
          ])
        );

      case 6:
        if (isUrl(text)) {
          s.data.cv = buildViewerLink(text);
          return finishApply(ctx);
        }
        return ctx.reply("❗ Отправьте своё резюме файлом pdf или приложите ссылку");
    }
  }

  // ===== РЕКОМЕНДАЦИИ =====
  if (ctx.session?.recommendFor) {
    const recommendedUsername = text;
    const rec = ctx.session.recommendFor;

    try {
      await saveRecommendation(
        rec.title,
        user.username || "",
        user.first_name || "",
        recommendedUsername,
        rec.sheetId
      );

      await ctx.reply(
        escapeMarkdownV2(`✅ Спасибо! Ты посоветовал пользователя ${recommendedUsername}.`),
        { ...mainKeyboard, parse_mode: "MarkdownV2" }
      );

      ctx.session.recommendFor = null;
    } catch (e) {
      console.error(e);
      await ctx.reply("❌ Ошибка при сохранении рекомендации.");
    }
  }
});

async function saveResponse(payload) {
  try {
    await apiPost("saveResponse", payload);
  } catch (err) {
    console.error("Ошибка при сохранении отклика:", err.message);
    throw err;
  }
}

function buildResponseNotificationText(payload) {
  const lines = [
    `Новый отклик на вакансию: ${payload.vacancyTitle}`,
    `Пользователь: ${payload.username || "(без username)"}`,
    `Имя TG: ${payload.name || "(не указано)"}`,
    `ФИО: ${payload.fullName || "(не указано)"}`,
    `Контакты: ${payload.contacts || "(не указано)"}`,
    `Английский: ${payload.english || "(не указано)"}`,
    `Ночные смены: ${payload.nightShift || "(не указано)"}`,
    `CV: ${payload.cvLink || "(не указано)"}`,
    `Дата: ${payload.createdAt || dayjs().format("YYYY-MM-DD HH:mm")}`,
  ];
  return lines.join("\n");
}

async function notifyNewResponseTelegram(payload) {
  if (!NOTIFY_CHAT_IDS.length) return;

  const message = buildResponseNotificationText(payload);
  const escapedMessage = escapeMarkdownV2(message);

  await Promise.all(NOTIFY_CHAT_IDS.map(async (rawTarget) => {
    try {
      const target = await resolveTelegramTarget(rawTarget);
      if (!target) {
        console.error("Пропускаю уведомление: не удалось разрешить Telegram target", rawTarget);
        return;
      }
      await bot.telegram.sendMessage(target, escapedMessage, {
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.error("Ошибка уведомления в Telegram:", rawTarget, err.message);
    }
  }));
}

async function notifyNewResponseEmail(payload) {
  if (!EMAIL_NOTIFY_TO.length || !emailTransporter) return;

  const subject = `Новый отклик: ${payload.vacancyTitle}`;
  const text = buildResponseNotificationText(payload);

  try {
    await emailTransporter.sendMail({
      from: SMTP_USER || "noreply@example.com",
      to: EMAIL_NOTIFY_TO.join(", "),
      subject,
      text,
    });
  } catch (err) {
    console.error("Ошибка отправки email-уведомления:", err.message);
  }
}

async function notifyNewResponse(payload) {
  try {
    await Promise.all([
      notifyNewResponseTelegram(payload),
      notifyNewResponseEmail(payload),
    ]);
  } catch (err) {
    console.error("Ошибка уведомления о новом отклике:", err.message);
  }
}

async function finishApply(ctx) {
  const s = ctx.session.apply;
  if (!s) return ctx.reply("❌ Начните отклик заново.", mainKeyboard);

  const payload = {
    action: "saveResponse",
    sheetId: s.sheetId,
    vacancyTitle: s.vacancy,
    username: ctx.from.username || "",
    name: ctx.from.first_name || "",
    fullName: s.data.name,
    birthDate: s.data.birth,
    contacts: s.data.contacts,
    english: s.data.english,
    nightShift: s.data.night,
    cvLink: s.data.cv,
    createdAt: dayjs().format("YYYY-MM-DD HH:mm"),
  };

  await saveResponse(payload);
  await notifyNewResponse(payload);

  await ctx.reply(
    escapeMarkdownV2(`✅ Спасибо! Ваш отклик на вакансию *${escapeMarkdownV2(s.vacancy)}* отправлен HR.`),
    { ...mainKeyboard, parse_mode: "MarkdownV2" }
  );
}

bot.launch()
  .then(() => console.log("Bot started"))
  .catch((err) => console.error("Bot launch failed:", err));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
