import "dotenv/config";
import { readFile, writeFile } from "fs/promises";
import { Telegraf, Markup } from "telegraf";
import dayjs from "dayjs";
import LocalSession from "telegraf-session-local";
import "dayjs/locale/ru.js";
dayjs.locale("ru");

const BOT_TOKEN = process.env.BOT_TOKEN;
const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const SUBSCRIBERS_FILE = new URL("./subscribers.json", import.meta.url);
const SENT_VACANCIES_FILE = new URL("./sentVacancies.json", import.meta.url);

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

function scriptRequestUrl(action) {
  if (!SCRIPT_URL) {
    throw new Error("GOOGLE_SCRIPT_URL не задан. Установите URL вашего Apps Script web app в переменной окружения GOOGLE_SCRIPT_URL.");
  }
  return `${SCRIPT_URL}?action=${encodeURIComponent(action)}`;
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

async function saveRecommendation(vacancyTitle, username, name, recommendedUsername) {
  await apiPost("saveRecommendation", {
    vacancyTitle,
    username,
    name,
    recommendedUsername,
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
    const vacancies = await getVacancies();
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

async function getVacancies() {
  try {
    const data = await apiGet("getVacancies");
    if (!Array.isArray(data)) return [];
    return data.map(({ id, title, city, description, photo, publishDate, telegraLink }) => ({
      id,
      title,
      city,
      description,
      photo,
      publishDate,
      telegraLink,
    }));
  } catch (err) {
    console.error("Ошибка при загрузке вакансий:", err.message);
    return [];
  }
}

bot.start(async (ctx) => {
  await addSubscriber(ctx.chat.id);
  return ctx.reply("👋 Привет! Я бот с вакансиями.", mainKeyboard);
});

bot.hears(/Вакансии/i, async (ctx) => {
  const vacancies = await getVacancies();
  if (!vacancies.length) return ctx.reply("Пока нет активных вакансий 🙈", mainKeyboard);

  const buttons = vacancies.map((v) => [Markup.button.callback(`${v.title} (${v.city})`, `job_${v.id}`)]);

  await ctx.reply("📋 Доступные вакансии:", Markup.inlineKeyboard(buttons, { columns: 1 }));
});

bot.action(/job_(.+)/, async (ctx) => {
  const vid = ctx.match[1];
  const vacancies = await getVacancies();
  const v = vacancies.find((vacancy) => vacancy.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  const photoUrl = v.photo || "https://picsum.photos/600/200";
  const publishDate = formatPublishDate(v.publishDate) || "не указано";
  const caption = `💼 *${escapeMarkdownV2(v.title)}*\n📍 ${escapeMarkdownV2(v.city)}\n🗓 Опубликовано: ${escapeMarkdownV2(publishDate)}`;

  await ctx.replyWithPhoto(photoUrl, {
    caption,
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📎 Откликнуться", callback_data: `apply_${v.id}` },
          { text: "🤝 Посоветовать", callback_data: `recommend_${v.id}` },
        ],
        [
          { text: "ℹ️ Подробнее", url: v.telegraLink || "https://telegra.ph/Test-vakansii-programmist-10-16" },
        ],
      ],
    },
  });
});

bot.action(/apply_(.+)/, async (ctx) => {
  const vid = ctx.match[1];
  const vacancies = await getVacancies();
  const v = vacancies.find((vacancy) => vacancy.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  ctx.session = ctx.session || {};
  ctx.session.apply = {
    step: 1,
    vacancy: v.title,
    data: {}
  };

  const message = `1️⃣ Укажите ФИО.`;
  await ctx.reply(escapeMarkdownV2(message), { ...mainKeyboard, parse_mode: "MarkdownV2" });
});

bot.action(/recommend_(.+)/, async (ctx) => {
  const vid = ctx.match[1];
  const vacancies = await getVacancies();
  const v = vacancies.find((vacancy) => vacancy.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.", mainKeyboard);

  ctx.session = ctx.session || {};
  ctx.session.recommendFor = v.title;

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

    try {
      await saveRecommendation(
        ctx.session.recommendFor,
        user.username || "",
        user.first_name || "",
        recommendedUsername
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

async function saveResponse(vacancyTitle, username, name, data) {
  try {
    await apiPost("saveResponse", {
      vacancyTitle,
      username,
      name,
      fullName: data.name,
      birthDate: data.birth,
      contacts: data.contacts,
      english: data.english,
      nightShift: data.night,
      cvLink: data.cv,
      createdAt: dayjs().format("YYYY-MM-DD HH:mm"),
    });
  } catch (err) {
    console.error("Ошибка при сохранении отклика:", err.message);
    throw err;
  }
}

async function finishApply(ctx) {
  const s = ctx.session.apply;
  const user = ctx.from;

  if (!s || !s.data) {
    return ctx.reply("❌ Что-то пошло не так. Пожалуйста, начните отклик заново.", mainKeyboard);
  }

  try {
    await saveResponse(
      s.vacancy,
      user.username || "",
      user.first_name || "",
      s.data
    );

    await ctx.reply(
      escapeMarkdownV2(`✅ Спасибо! Ваш отклик на вакансию *${escapeMarkdownV2(s.vacancy)}* отправлен HR.`),
      { ...mainKeyboard, parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Ошибка при сохранении отклика. Попробуйте позже.", mainKeyboard);
  } finally {
    ctx.session.apply = null;
  }
}

function buildViewerLink(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith(".pdf")) {
      return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
    }
    if (/\.(docx?|xlsx?|pptx?|rtf|odt|txt)$/i.test(path)) {
      return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
    }
  } catch (err) {
    console.error("buildViewerLink: invalid URL", err, { url });
  }
  return url;
}

function isUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

bot.launch();
console.log("🤖 Бот запущен!");

checkForNewVacancies();
setInterval(checkForNewVacancies, 60 * 60 * 1000);
