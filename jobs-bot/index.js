import "dotenv/config";
console.log("🔹 GOOGLE_PROJECT_ID:", googleCredentials.project_id);
import { Telegraf, Markup } from "telegraf";
import { google } from "googleapis";
import dayjs from "dayjs";
import LocalSession from "telegraf-session-local";
import googleCredentials from "./googleCredentials.js";
import "dayjs/locale/ru.js";
dayjs.locale("ru");

const BOT_TOKEN = "7352494667:AAE4ozNZdOSg-gYTWKZjt-eREoKsk4UmYfg";
const SHEET_ID = "1p0oYa-bzPXpk-wEixBNnIIGzCKrzWAALhlhX_nzDyo4";

const bot = new Telegraf(BOT_TOKEN);

// ===== Локальная сессия =====
const localSession = new LocalSession({
  database: "sessions.json",
  property: "session",
});
bot.use(localSession.middleware());

// ===== Экранирование MarkdownV2 =====
function escapeMarkdownV2(text) {
  if (!text) return "";
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// ===== Форматирование даты публикации =====
function formatPublishDate(raw) {
  if (!raw) return dayjs().format("D MMMM YYYY");

  let date = dayjs(raw, ["YYYY-MM-DD", "DD.MM.YYYY"], true);
  if (date.isValid()) return date.format("D MMMM YYYY");

  if (!isNaN(raw)) {
    date = dayjs("1899-12-30").add(Number(raw), "day");
    if (date.isValid()) return date.format("D MMMM YYYY");
  }

  return raw; // на крайний случай возвращаем оригинал
}


// ===== Получение вакансий с ссылкой на Telegra.ph =====
async function getVacancies() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: googleCredentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Vacancies!A2:G", // ID | Title | City | Description | Photo | PublishDate | TelegraLink
    });

    const rows = res.data.values || [];
    return rows.map(([id, title, city, description, photo, publishDate, telegraLink]) => ({
      id,
      title,
      city,
      description,
      photo,
      publishDate,
      telegraLink
    }));
  } catch (err) {
    console.error("Ошибка при загрузке вакансий:", err.message);
    return [];
  }
}


// ===== Сохранение отклика =====
async function saveResponse(vacancyTitle, username, name, fileLink) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: googleCredentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const values = [
      [vacancyTitle, username, name, fileLink, dayjs().format("YYYY-MM-DD HH:mm")],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Responses!A:E",
      valueInputOption: "USER_ENTERED",
      resource: { values },
    });
  } catch (err) {
    console.error("Ошибка при сохранении отклика:", err.message);
    throw err;
  }
}

// ===== Старт бота =====
bot.start((ctx) => {
  return ctx.reply(
    "👋 Привет! Я бот с вакансиями.",
    Markup.keyboard([["💼 Вакансии"]]).resize().oneTime(false)
  );
});

// ===== Плавающая кнопка "Вакансии" =====
bot.hears(/Вакансии/i, async (ctx) => {
  const vacancies = await getVacancies();
  if (!vacancies.length) return ctx.reply("Пока нет активных вакансий 🙈");

  // Только название и город, без описания
  const buttons = vacancies.map((v) => [
    Markup.button.callback(`${v.title} (${v.city})`, `job_${v.id}`)
  ]);

  await ctx.reply(
    "📋 Доступные вакансии:",
    Markup.inlineKeyboard(buttons, { columns: 1 })
  );
});

// ===== Просмотр вакансии + кнопки + ссылка на полный текст =====
bot.action(/job_(.+)/, async (ctx) => {
  const vid = ctx.match[1];
  const vacancies = await getVacancies();
  const v = vacancies.find(v => v.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.");

  const photoUrl = v.photo || "https://picsum.photos/600/200";

  // Форматируем дату публикации корректно
  let publishDate = dayjs().format("D MMMM YYYY"); // дефолтная дата — сегодня
  if (v.publishDate) {
    const dateStr = v.publishDate.trim();
    let parsed = dayjs(dateStr, "YYYY-MM-DD", true);
    if (!parsed.isValid()) parsed = dayjs(dateStr, "DD.MM.YYYY", true);
    if (parsed.isValid()) publishDate = parsed.format("D MMMM YYYY");
  }

  // Краткий текст для превью (без описания)
  const caption = `💼 *${escapeMarkdownV2(v.title)}*\n📍 ${escapeMarkdownV2(v.city)}\n🗓 Опубликовано: ${escapeMarkdownV2(publishDate)}`;

  await ctx.replyWithPhoto(photoUrl, {
    caption,
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📎 Откликнуться", callback_data: `apply_${v.id}` },
          { text: "🤝 Посоветовать", callback_data: `recommend_${v.id}` }
        ],
        [
          { text: "ℹ️ Подробнее", url: v.telegraLink || "https://telegra.ph/Test-vakansii-programmist-10-16" }
        ]
      ]
    }
  });
});



// ===== Нажатие "Откликнуться" =====
bot.action(/apply_(.+)/, async (ctx) => {
  const vid = ctx.match[1];
  const vacancies = await getVacancies();
  const v = vacancies.find((v) => v.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.");

  ctx.session = ctx.session || {};
  ctx.session.applyFor = v.title;

  const message = `Отлично! 📝 Пришли своё резюме для вакансии *${v.title}* (PDF, DOCX и т.п.).`;

  await ctx.reply(
    escapeMarkdownV2(message),
    { parse_mode: "MarkdownV2" }
  );
});

// ===== Нажатие "Посоветовать" =====
bot.action(/recommend_(.+)/, async (ctx) => {
  const vid = ctx.match[1];
  const vacancies = await getVacancies();
  const v = vacancies.find((v) => v.id === vid);
  if (!v) return ctx.reply("Вакансия не найдена.");

  ctx.session = ctx.session || {};
  ctx.session.recommendFor = v.title;

  const message = `Отлично! 🙌 Пришли Telegram того человека, которого хочешь посоветовать для вакансии *${v.title}*.`;  

  await ctx.reply(
    escapeMarkdownV2(message),
    { parse_mode: "MarkdownV2" }
  );
});

// ===== Приём файла резюме =====
bot.on("document", async (ctx) => {
  const file = ctx.message.document;
  const user = ctx.from;

  if (!ctx.session || !ctx.session.applyFor) {
    return ctx.reply(
      "⚠️ Пожалуйста, сначала выбери вакансию и нажми кнопку 'Откликнуться'."
    );
  }

  const vacancyTitle = ctx.session.applyFor;
  const fileLink = await ctx.telegram.getFileLink(file.file_id);

  try {
    await saveResponse(
      vacancyTitle,
      user.username || "",
      user.first_name || "",
      fileLink.href
    );

    await ctx.reply(
      escapeMarkdownV2(`✅ Спасибо! Ваш отклик на вакансию *${escapeMarkdownV2(vacancyTitle)}* отправлен HR.`),
      { parse_mode: "MarkdownV2" }
    );

    ctx.session.applyFor = null;
  } catch (e) {
    console.error(e);
    await ctx.reply("❌ Ошибка при сохранении отклика. Попробуйте позже.");
  }
});

// ===== Приём рекомендации =====
bot.on("text", async (ctx) => {
  if (!ctx.session || !ctx.session.recommendFor) return;

  const recommendedUsername = ctx.message.text;
  const vacancyTitle = ctx.session.recommendFor;
  const user = ctx.from;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: googleCredentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const values = [
      [vacancyTitle, user.username || "", user.first_name || "", recommendedUsername, dayjs().format("YYYY-MM-DD HH:mm")]
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Recommendations!A:E",
      valueInputOption: "USER_ENTERED",
      resource: { values },
    });

    await ctx.reply(
        escapeMarkdownV2(`✅ Спасибо! Ты посоветовал пользователя ${recommendedUsername} для вакансии *${vacancyTitle}*.`),
        { parse_mode: "MarkdownV2" }
    );

    ctx.session.recommendFor = null;
  } catch (e) {
    console.error(e);
    await ctx.reply("❌ Ошибка при сохранении рекомендации. Попробуй позже.");
  }
});

// ===== Запуск бота =====
bot.launch();
console.log("🤖 Бот запущен!");
