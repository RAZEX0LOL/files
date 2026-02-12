require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const { users, services, bookings, orders, requests } = require('./database');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Демо Бизнес';

// === СЕССИИ (хранение состояния диалога) ===
bot.use(session());

function getSession(ctx) {
  ctx.session ??= {};
  return ctx.session;
}

// === РЕГИСТРАЦИЯ ПОЛЬЗОВАТЕЛЯ ===
bot.use((ctx, next) => {
  if (ctx.from) {
    users.upsert(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  }
  return next();
});

// === ГЛАВНОЕ МЕНЮ ===
function mainMenu() {
  return Markup.keyboard([
    ['📋 Услуги и цены', '📅 Записаться'],
    ['🛒 Сделать заказ', '📩 Оставить заявку'],
    ['📞 Контакты', '👤 Мои записи'],
  ]).resize();
}

function adminMenu() {
  return Markup.keyboard([
    ['📊 Статистика', '📋 Новые записи'],
    ['📣 Рассылка', '⬅️ Обычное меню'],
  ]).resize();
}

// === /start ===
bot.start((ctx) => {
  const name = ctx.from.first_name || 'друг';
  ctx.reply(
    `👋 Привет, ${name}!\n\n` +
      `Добро пожаловать в «${BUSINESS_NAME}»!\n\n` +
      `Здесь вы можете:\n` +
      `📋 Посмотреть услуги и цены\n` +
      `📅 Записаться онлайн\n` +
      `🛒 Сделать заказ\n` +
      `📩 Оставить заявку\n\n` +
      `Выберите нужный пункт в меню 👇`,
    mainMenu()
  );
});

// === УСЛУГИ И ЦЕНЫ ===
bot.hears('📋 Услуги и цены', (ctx) => {
  const allServices = services.getAll();

  if (allServices.length === 0) {
    return ctx.reply('Пока нет доступных услуг.');
  }

  let text = `📋 *Наши услуги:*\n\n`;

  allServices.forEach((s, i) => {
    const price = s.price > 0 ? `${s.price} ₽` : 'Бесплатно';
    const duration = s.duration >= 60 ? `${Math.floor(s.duration / 60)}ч ${s.duration % 60 ? s.duration % 60 + 'мин' : ''}` : `${s.duration} мин`;
    text += `*${i + 1}. ${s.name}*\n`;
    text += `   💰 ${price} | ⏱ ${duration}\n`;
    if (s.description) text += `   _${s.description}_\n`;
    text += `\n`;
  });

  text += `\nЧтобы записаться, нажмите «📅 Записаться»`;

  ctx.reply(text, { parse_mode: 'Markdown' });
});

// === ЗАПИСЬ НА УСЛУГУ ===
bot.hears('📅 Записаться', (ctx) => {
  const allServices = services.getAll();
  const session = getSession(ctx);
  session.step = 'booking_service';

  const buttons = allServices.map((s) => [
    Markup.button.callback(
      `${s.name} — ${s.price > 0 ? s.price + ' ₽' : 'Бесплатно'}`,
      `book_service_${s.id}`
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Отмена', 'cancel')]);

  ctx.reply('📅 *Выберите услугу для записи:*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
});

// Выбор услуги
bot.action(/^book_service_(\d+)$/, (ctx) => {
  const serviceId = Number(ctx.match[1]);
  const service = services.getById(serviceId);
  const session = getSession(ctx);

  if (!service) {
    return ctx.answerCbQuery('Услуга не найдена');
  }

  session.booking = { serviceId, serviceName: service.name };
  session.step = 'booking_date';

  ctx.answerCbQuery();
  ctx.editMessageText(
    `✅ Вы выбрали: *${service.name}*\n\n` +
      `📅 Напишите желаемую *дату* (например: 15.02, завтра, понедельник):`,
    { parse_mode: 'Markdown' }
  );
});

// === ЗАКАЗ ===
bot.hears('🛒 Сделать заказ', (ctx) => {
  const session = getSession(ctx);
  session.step = 'order_items';
  session.order = {};

  ctx.reply(
    '🛒 *Оформление заказа*\n\n' +
      'Опишите, что хотите заказать:',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel')]]) }
  );
});

// === ЗАЯВКА ===
bot.hears('📩 Оставить заявку', (ctx) => {
  const session = getSession(ctx);
  session.step = 'request_message';

  ctx.reply(
    '📩 *Оставить заявку*\n\n' +
      'Напишите ваш вопрос или пожелание, и мы свяжемся с вами:',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel')]]) }
  );
});

// === МОИ ЗАПИСИ ===
bot.hears('👤 Мои записи', (ctx) => {
  const userBookings = bookings.getByUser(ctx.from.id);

  if (userBookings.length === 0) {
    return ctx.reply('У вас пока нет записей.\n\nНажмите «📅 Записаться» чтобы записаться.');
  }

  let text = `👤 *Ваши записи:*\n\n`;

  const statusMap = {
    new: '🟡 Новая',
    confirmed: '🟢 Подтверждена',
    done: '✅ Выполнена',
    cancelled: '🔴 Отменена',
  };

  userBookings.forEach((b, i) => {
    text += `*${i + 1}. ${b.service_name || 'Услуга'}*\n`;
    text += `   📅 ${b.date || '—'} в ${b.time || '—'}\n`;
    text += `   Статус: ${statusMap[b.status] || b.status}\n\n`;
  });

  ctx.reply(text, { parse_mode: 'Markdown' });
});

// === КОНТАКТЫ ===
bot.hears('📞 Контакты', (ctx) => {
  ctx.reply(
    `📞 *Контакты «${BUSINESS_NAME}»*\n\n` +
      `📱 Телефон: +7 (XXX) XXX-XX-XX\n` +
      `📍 Адрес: г. Саратов, ул. Примерная, 1\n` +
      `🕐 Режим работы: Пн-Сб 9:00-20:00\n` +
      `🌐 Сайт: example.com\n\n` +
      `Напишите нам, и мы ответим в ближайшее время! 😊`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📩 Написать нам', 'leave_request')],
      ]),
    }
  );
});

bot.action('leave_request', (ctx) => {
  const session = getSession(ctx);
  session.step = 'request_message';
  ctx.answerCbQuery();
  ctx.reply('Напишите ваш вопрос или пожелание:');
});

// === ОТМЕНА ===
bot.action('cancel', (ctx) => {
  const session = getSession(ctx);
  session.step = null;
  session.booking = null;
  session.order = null;
  ctx.answerCbQuery('Отменено');
  ctx.editMessageText('❌ Действие отменено.');
  ctx.reply('Главное меню 👇', mainMenu());
});

// === АДМИН-ПАНЕЛЬ ===
bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('⛔ Доступ запрещён.');
  }
  ctx.reply('🔐 *Админ-панель*\n\nВыберите действие:', {
    parse_mode: 'Markdown',
    ...adminMenu(),
  });
});

bot.hears('⬅️ Обычное меню', (ctx) => {
  ctx.reply('Главное меню 👇', mainMenu());
});

// Статистика
bot.hears('📊 Статистика', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const totalUsers = users.count();
  const totalBookings = bookings.count();
  const totalOrders = orders.count();
  const totalRequests = requests.count();

  ctx.reply(
    `📊 *Статистика бота*\n\n` +
      `👥 Пользователей: ${totalUsers}\n` +
      `📅 Записей: ${totalBookings}\n` +
      `🛒 Заказов: ${totalOrders}\n` +
      `📩 Заявок: ${totalRequests}`,
    { parse_mode: 'Markdown' }
  );
});

// Новые записи
bot.hears('📋 Новые записи', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;

  const newBookings = bookings.getNew();

  if (newBookings.length === 0) {
    return ctx.reply('✅ Нет новых записей.');
  }

  let text = `📋 *Новые записи (${newBookings.length}):*\n\n`;

  newBookings.forEach((b, i) => {
    const user = users.get(b.user_id);
    const name = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Неизвестный';
    const username = user?.username ? `@${user.username}` : '';

    text += `*${i + 1}. ${b.service_name}*\n`;
    text += `   👤 ${name} ${username}\n`;
    text += `   📅 ${b.date || '—'} в ${b.time || '—'}\n`;
    if (b.comment) text += `   💬 ${b.comment}\n`;
    text += `\n`;
  });

  const buttons = newBookings.map((b) => [
    Markup.button.callback(`✅ Подтвердить #${b.id}`, `confirm_${b.id}`),
    Markup.button.callback(`❌ Отменить #${b.id}`, `cancel_booking_${b.id}`),
  ]);

  ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
});

// Подтверждение/отмена записи админом
bot.action(/^confirm_(\d+)$/, (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const id = Number(ctx.match[1]);
  bookings.updateStatus(id, 'confirmed');
  ctx.answerCbQuery(`Запись #${id} подтверждена`);
  ctx.editMessageText(`✅ Запись #${id} подтверждена!`);
});

bot.action(/^cancel_booking_(\d+)$/, (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const id = Number(ctx.match[1]);
  bookings.updateStatus(id, 'cancelled');
  ctx.answerCbQuery(`Запись #${id} отменена`);
  ctx.editMessageText(`🔴 Запись #${id} отменена.`);
});

// Рассылка
bot.hears('📣 Рассылка', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const session = getSession(ctx);
  session.step = 'broadcast';
  ctx.reply('📣 Напишите текст рассылки (получат все пользователи бота):');
});

// === ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (ШАГИ ДИАЛОГА) ===
bot.on('text', async (ctx) => {
  const session = getSession(ctx);
  const text = ctx.message.text;

  // --- Запись: ввод даты ---
  if (session.step === 'booking_date' && session.booking) {
    session.booking.date = text;
    session.step = 'booking_time';
    return ctx.reply(
      `📅 Дата: *${text}*\n\n⏰ Теперь напишите желаемое *время* (например: 14:00, после обеда):`,
      { parse_mode: 'Markdown' }
    );
  }

  // --- Запись: ввод времени ---
  if (session.step === 'booking_time' && session.booking) {
    session.booking.time = text;
    session.step = 'booking_comment';
    return ctx.reply(
      `⏰ Время: *${text}*\n\n💬 Хотите добавить комментарий? Напишите или нажмите кнопку:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('Без комментария →', 'no_comment')]]),
      }
    );
  }

  // --- Запись: комментарий ---
  if (session.step === 'booking_comment' && session.booking) {
    session.booking.comment = text;
    return finishBooking(ctx);
  }

  // --- Заказ: описание ---
  if (session.step === 'order_items') {
    session.order = { items: text };
    session.step = 'order_address';
    return ctx.reply('📍 Укажите адрес доставки (или напишите "самовывоз"):');
  }

  // --- Заказ: адрес ---
  if (session.step === 'order_address') {
    session.order.address = text;
    session.step = 'order_comment';
    return ctx.reply(
      '💬 Хотите добавить комментарий к заказу?',
      Markup.inlineKeyboard([[Markup.button.callback('Без комментария →', 'no_order_comment')]])
    );
  }

  // --- Заказ: комментарий ---
  if (session.step === 'order_comment') {
    session.order.comment = text;
    return finishOrder(ctx);
  }

  // --- Заявка ---
  if (session.step === 'request_message') {
    const reqId = requests.create(ctx.from.id, 'general', text);
    session.step = null;

    ctx.reply(`✅ *Заявка #${reqId} принята!*\n\nМы свяжемся с вами в ближайшее время.`, {
      parse_mode: 'Markdown',
    });

    // Уведомление админу
    const user = users.get(ctx.from.id);
    const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Неизвестный';
    const username = user?.username ? `@${user.username}` : '';

    return notifyAdmin(
      ctx,
      `📩 *Новая заявка #${reqId}*\n\n` +
        `👤 ${name} ${username}\n` +
        `💬 ${text}`
    );
  }

  // --- Рассылка (админ) ---
  if (session.step === 'broadcast' && ctx.from.id === ADMIN_ID) {
    session.step = null;
    // Получаем всех пользователей
    const { db } = require('./database');
    const allUsers = db.prepare('SELECT telegram_id FROM users').all();
    let sent = 0;
    let failed = 0;

    for (const u of allUsers) {
      try {
        await ctx.telegram.sendMessage(u.telegram_id, text);
        sent++;
      } catch {
        failed++;
      }
    }

    return ctx.reply(`📣 Рассылка завершена!\n\n✅ Доставлено: ${sent}\n❌ Не доставлено: ${failed}`);
  }
});

// Без комментария (запись)
bot.action('no_comment', (ctx) => {
  const session = getSession(ctx);
  session.booking.comment = null;
  ctx.answerCbQuery();
  return finishBooking(ctx);
});

// Без комментария (заказ)
bot.action('no_order_comment', (ctx) => {
  const session = getSession(ctx);
  session.order.comment = null;
  ctx.answerCbQuery();
  return finishOrder(ctx);
});

// === ФИНАЛИЗАЦИЯ ЗАПИСИ ===
async function finishBooking(ctx) {
  const session = getSession(ctx);
  const b = session.booking;

  const bookingId = bookings.create(
    ctx.from.id,
    b.serviceId,
    b.serviceName,
    b.date,
    b.time,
    b.comment
  );

  session.step = null;
  session.booking = null;

  ctx.reply(
    `✅ *Вы записаны!*\n\n` +
      `📋 Услуга: ${b.serviceName}\n` +
      `📅 Дата: ${b.date}\n` +
      `⏰ Время: ${b.time}\n` +
      (b.comment ? `💬 Комментарий: ${b.comment}\n` : '') +
      `\n📌 Запись #${bookingId}\n\n` +
      `Мы подтвердим запись в ближайшее время!`,
    { parse_mode: 'Markdown' }
  );

  // Уведомление админу
  const user = users.get(ctx.from.id);
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Неизвестный';
  const username = user?.username ? `@${user.username}` : '';

  return notifyAdmin(
    ctx,
    `📅 *Новая запись #${bookingId}*\n\n` +
      `👤 ${name} ${username}\n` +
      `📋 ${b.serviceName}\n` +
      `📅 ${b.date} в ${b.time}\n` +
      (b.comment ? `💬 ${b.comment}` : ''),
    Markup.inlineKeyboard([
      [Markup.button.callback(`✅ Подтвердить`, `confirm_${bookingId}`)],
      [Markup.button.callback(`❌ Отменить`, `cancel_booking_${bookingId}`)],
    ])
  );
}

// === ФИНАЛИЗАЦИЯ ЗАКАЗА ===
async function finishOrder(ctx) {
  const session = getSession(ctx);
  const o = session.order;

  const orderId = orders.create(ctx.from.id, o.items, 0, o.address, o.comment);

  session.step = null;
  session.order = null;

  ctx.reply(
    `✅ *Заказ #${orderId} оформлен!*\n\n` +
      `🛒 ${o.items}\n` +
      `📍 ${o.address}\n` +
      (o.comment ? `💬 ${o.comment}\n` : '') +
      `\nМы свяжемся с вами для подтверждения!`,
    { parse_mode: 'Markdown' }
  );

  // Уведомление админу
  const user = users.get(ctx.from.id);
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Неизвестный';
  const username = user?.username ? `@${user.username}` : '';

  return notifyAdmin(
    ctx,
    `🛒 *Новый заказ #${orderId}*\n\n` +
      `👤 ${name} ${username}\n` +
      `📦 ${o.items}\n` +
      `📍 ${o.address}\n` +
      (o.comment ? `💬 ${o.comment}` : '')
  );
}

// === УВЕДОМЛЕНИЕ АДМИНУ ===
async function notifyAdmin(ctx, text, extra = {}) {
  if (!ADMIN_ID) return;
  try {
    await ctx.telegram.sendMessage(ADMIN_ID, text, {
      parse_mode: 'Markdown',
      ...extra,
    });
  } catch (err) {
    console.error('Ошибка уведомления админу:', err.message);
  }
}

// === ЗАПУСК ===
bot.launch()
  .then(() => {
    console.log(`🤖 Бот "${BUSINESS_NAME}" запущен!`);
    console.log(`📊 Admin ID: ${ADMIN_ID}`);
  })
  .catch((err) => {
    console.error('Ошибка запуска бота:', err);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
