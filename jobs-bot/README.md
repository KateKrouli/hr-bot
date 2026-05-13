🧭 1. Архитектура проекта

Система состоит из трёх частей:

Telegram-бот (Node.js + Telegraf)
UI, сценарии, сбор анкеты
Отправляет/читает данные через HTTP
Google Apps Script (backend API)
REST-обёртка над таблицей
Методы: getVacancies, saveResponse, saveRecommendation
Google Sheets (база данных)
Хранение вакансий, откликов и рекомендаций


⚙️ 2. Что нужно создать с нуля

2.1 Telegram-бот
Открыть Telegram
Найти BotFather

Выполнить:

/start
/newbot
Получить BOT_TOKEN

2.2 Google Sheets

Создать таблицу с 3 листами:

📄 Vacancies
A: ID
B: Title
C: City
D: Description
E: Photo (URL)
F: PublishDate
G: TelegraLink

📄 Responses
A: Вакансия
B: Username
C: Имя TG
D: ФИО
E: Дата рождения
F: Контакты
G: Английский
H: Ночные смены
I: Резюме
J: Дата

📄 Recommendations
A: Вакансия
B: Username
C: Имя
D: Рекомендованный пользователь
E: Дата

Скопировать ID таблицы из URL (формат: 1p0oYa-bzPXpk-wEixBNnIIGzCKrzWAALhlhX_nzDyo4) и вставить в const SHEET_ID в googleAppsScript.gs

2.3 Google Apps Script (API)

В таблице → Extensions → Apps Script
Вставить код из googleAppsScript.gs
Нажать Deploy → Web App

Настройки:

Execute as: Me
Access: Anyone
Получить URL вида:
https://script.google.com/macros/s/XXXX/exec


🔐 3. Переменные окружения (.env)

В корне проекта создать .env:

BOT_TOKEN=your_telegram_bot_token
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec

# Уведомления о новых откликах
NOTIFY_CHAT_IDS=12345678
EMAIL_NOTIFY_TO=hr@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=smtp-user
SMTP_PASS=smtp-password

> Важно: используйте numeric `chat_id`, а не `@username`. После запуска бота отправьте ему команду `/myid` — он ответит вашим chat_id.

📦 4. Установка и запуск
npm install
node index.js

🧠 5. Основная логика бота

Потоки:
1. Просмотр вакансий
кнопка "💼 Вакансии"
получение через getVacancies
2. Отклик (state machine)
1. ФИО
2. ДР
3. Контакты
4. Английский
5. Ночные смены (кнопки)
6. Резюме (файл или ссылка)

Состояние хранится в:

ctx.session.apply

3. Рекомендация
пользователь отправляет username
сохраняется в Recommendations

4. Авто-рассылка вакансий
проверка каждые 60 минут
новые вакансии → отправка подписчикам

Файлы:

subscribers.json
sentVacancies.json