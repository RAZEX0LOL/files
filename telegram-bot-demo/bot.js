require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const { users, services, bookings, orders, requests, db } = require('./database');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = Number(process.env.ADMIN_ID);
const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Демо Бизнес';

bot.use(session());

function getSession(ctx) {
  ctx.session ??= {};
  return ctx.session;
}

function isAdmin(ctx) {
  return ctx.from.id === ADMIN_ID;
}

bot.use((ctx, next) => {
  if (ctx.from) {
    users.upsert(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  }
  return next();
});

// =============================================
// КЛИЕНТСКАЯ ЧАСТЬ
// =============================================

function mainMenu() {
  return Markup.keyboard([
    ['📋 Услуги и цены', '📅 Записаться'],
    ['🛒 Сделать заказ', '📩 Оставить заявку'],
    ['📞 Контакты', '👤 Мои записи'],
  ]).resize();
}

bot.start((ctx) => {
  const name = ctx.from.first_name || 'друг';
  const session = getSession(ctx);
  session.step = null;

  ctx.reply(
    `👋 Привет, ${name}!\n\n` +
      `Добро пожаловать в «${BUSINESS_NAME}»!\n\n` +
      `📋 Посмотреть услуги и цены\n` +
      `📅 Записаться онлайн\n` +
      `🛒 Сделать заказ\n` +
      `📩 Оставить заявку\n\n` +
      `Выберите нужный пункт в меню 👇`,
    mainMenu()
  );
});

bot.hears('📋 Услуги и цены', (ctx) => {
  const allServices = services.getAll();
  if (allServices.length === 0) return ctx.reply('Пока нет доступных услуг.');

  let text = `📋 *Наши услуги:*\n\n`;
  allServices.forEach((s, i) => {
    const price = s.price > 0 ? `${s.price} ₽` : 'Бесплатно';
    const dur = s.duration >= 60
      ? `${Math.floor(s.duration / 60)}ч${s.duration % 60 ? ' ' + (s.duration % 60) + 'мин' : ''}`
      : `${s.duration} мин`;
    text += `*${i + 1}. ${s.name}*\n   💰 ${price} | ⏱ ${dur}\n`;
    if (s.description) text += `   _${s.description}_\n`;
    text += `\n`;
  });
  text += `Чтобы записаться → «📅 Записаться»`;
  ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.hears('📅 Записаться', (ctx) => {
  const allServices = services.getAll();
  const session = getSession(ctx);
  session.step = 'booking_service';

  const buttons = allServices.map((s) => [
    Markup.button.callback(`${s.name} — ${s.price > 0 ? s.price + ' ₽' : 'Бесплатно'}`, `book_${s.id}`),
  ]);
  buttons.push([Markup.button.callback('❌ Отмена', 'cancel')]);

  ctx.reply('📅 *Выберите услугу:*', { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^book_(\d+)$/, (ctx) => {
  const service = services.getById(Number(ctx.match[1]));
  if (!service) return ctx.answerCbQuery('Услуга не найдена');

  const session = getSession(ctx);
  session.booking = { serviceId: service.id, serviceName: service.name };
  session.step = 'booking_date';

  ctx.answerCbQuery();
  ctx.editMessageText(
    `✅ Услуга: *${service.name}*\n\n📅 Напишите желаемую *дату* (например: 15.02, завтра):`,
    { parse_mode: 'Markdown' }
  );
});

bot.hears('🛒 Сделать заказ', (ctx) => {
  const session = getSession(ctx);
  session.step = 'order_items';
  session.order = {};
  ctx.reply('🛒 *Оформление заказа*\n\nОпишите, что хотите заказать:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel')]]),
  });
});

bot.hears('📩 Оставить заявку', (ctx) => {
  const session = getSession(ctx);
  session.step = 'request_message';
  ctx.reply('📩 Напишите ваш вопрос или пожелание:', {
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel')]]),
  });
});

bot.hears('👤 Мои записи', (ctx) => {
  const list = bookings.getByUser(ctx.from.id);
  if (list.length === 0) return ctx.reply('У вас пока нет записей. Нажмите «📅 Записаться».');

  const statusMap = { new: '🟡 Новая', confirmed: '🟢 Подтверждена', done: '✅ Выполнена', cancelled: '🔴 Отменена' };
  let text = `👤 *Ваши записи:*\n\n`;
  list.forEach((b, i) => {
    text += `*${i + 1}. ${b.service_name || 'Услуга'}*\n`;
    text += `   📅 ${b.date || '—'} в ${b.time || '—'}\n`;
    text += `   ${statusMap[b.status] || b.status}\n\n`;
  });
  ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.hears('📞 Контакты', (ctx) => {
  ctx.reply(
    `📞 *«${BUSINESS_NAME}»*\n\n` +
      `📱 Телефон: +7 (XXX) XXX-XX-XX\n` +
      `📍 г. Саратов, ул. Примерная, 1\n` +
      `🕐 Пн-Сб 9:00-20:00`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('cancel', (ctx) => {
  const session = getSession(ctx);
  session.step = null;
  session.booking = null;
  session.order = null;
  ctx.answerCbQuery('Отменено');
  ctx.editMessageText('❌ Отменено.');
  ctx.reply('Главное меню 👇', mainMenu());
});

bot.action('no_comment', (ctx) => {
  const session = getSession(ctx);
  if (session.booking) { session.booking.comment = null; ctx.answerCbQuery(); return finishBooking(ctx); }
});

bot.action('no_order_comment', (ctx) => {
  const session = getSession(ctx);
  if (session.order) { session.order.comment = null; ctx.answerCbQuery(); return finishOrder(ctx); }
});

// =============================================
// АДМИН-ПАНЕЛЬ
// =============================================

function adminMainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'adm_stats')],
    [Markup.button.callback('📅 Записи', 'adm_bookings'), Markup.button.callback('🛒 Заказы', 'adm_orders')],
    [Markup.button.callback('📩 Заявки', 'adm_requests'), Markup.button.callback('👥 Клиенты', 'adm_clients')],
    [Markup.button.callback('📋 Управление услугами', 'adm_services')],
    [Markup.button.callback('📣 Рассылка', 'adm_broadcast')],
    [Markup.button.callback('⚙️ Настройки', 'adm_settings')],
  ]);
}

bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Доступ запрещён.');
  const session = getSession(ctx);
  session.step = null;
  ctx.reply('🔐 *Админ-панель*\n\nВыберите раздел:', { parse_mode: 'Markdown', ...adminMainMenu() });
});

bot.action('adm_back', (ctx) => {
  if (!isAdmin(ctx)) return;
  const session = getSession(ctx);
  session.step = null;
  ctx.answerCbQuery();
  ctx.editMessageText('🔐 *Админ-панель*\n\nВыберите раздел:', { parse_mode: 'Markdown', ...adminMainMenu() });
});

// --- СТАТИСТИКА ---
bot.action('adm_stats', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();

  const totalUsers = users.count();
  const totalBookings = bookings.count();
  const totalOrders = orders.count();
  const totalRequests = requests.count();
  const newBookings = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status='new'").get().c;
  const newOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='new'").get().c;
  const newRequests = db.prepare("SELECT COUNT(*) as c FROM requests WHERE status='new'").get().c;
  const todayBookings = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE date(created_at)=date('now')").get().c;
  const weekUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-7 days')").get().c;

  ctx.editMessageText(
    `📊 *Статистика*\n\n` +
      `👥 Клиентов: *${totalUsers}* (за неделю: +${weekUsers})\n\n` +
      `📅 Записей: *${totalBookings}* (новых: 🟡 ${newBookings})\n` +
      `🛒 Заказов: *${totalOrders}* (новых: 🟡 ${newOrders})\n` +
      `📩 Заявок: *${totalRequests}* (новых: 🟡 ${newRequests})\n\n` +
      `📅 Записей сегодня: ${todayBookings}`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]]) }
  );
});

// --- ЗАПИСИ ---
bot.action('adm_bookings', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();
  ctx.editMessageText('📅 *Записи — фильтр:*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🟡 Новые', 'adm_bk_new'), Markup.button.callback('🟢 Подтверждённые', 'adm_bk_confirmed')],
      [Markup.button.callback('✅ Выполненные', 'adm_bk_done'), Markup.button.callback('🔴 Отменённые', 'adm_bk_cancelled')],
      [Markup.button.callback('📋 Все', 'adm_bk_all')],
      [Markup.button.callback('⬅️ Назад', 'adm_back')],
    ]),
  });
});

bot.action(/^adm_bk_(new|confirmed|done|cancelled|all)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();

  const filter = ctx.match[1];
  let query = `SELECT b.*, u.first_name, u.last_name, u.username, u.phone
    FROM bookings b LEFT JOIN users u ON b.user_id = u.telegram_id`;
  const params = [];
  if (filter !== 'all') { query += ' WHERE b.status = ?'; params.push(filter); }
  query += ' ORDER BY b.created_at DESC LIMIT 15';

  const list = db.prepare(query).all(...params);
  const statusIcon = { new: '🟡', confirmed: '🟢', done: '✅', cancelled: '🔴' };
  const filterNames = { new: 'Новые', confirmed: 'Подтверждённые', done: 'Выполненные', cancelled: 'Отменённые', all: 'Все' };

  if (list.length === 0) {
    return ctx.editMessageText(`Нет записей (${filterNames[filter]}).`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К записям', 'adm_bookings')]]),
    });
  }

  let text = `📅 *${filterNames[filter]} записи:*\n\n`;
  const buttons = [];

  list.forEach((b) => {
    const name = `${b.first_name || ''} ${b.last_name || ''}`.trim() || '—';
    const un = b.username ? ` @${b.username}` : '';
    text += `${statusIcon[b.status] || '⚪'} *#${b.id}* ${b.service_name}\n`;
    text += `   👤 ${name}${un}\n`;
    text += `   📅 ${b.date || '—'} в ${b.time || '—'}\n`;
    if (b.comment) text += `   💬 ${b.comment}\n`;
    text += `\n`;

    if (b.status === 'new') {
      buttons.push([
        Markup.button.callback(`✅ Подтвердить #${b.id}`, `bk_confirm_${b.id}`),
        Markup.button.callback(`❌ Отменить #${b.id}`, `bk_cancel_${b.id}`),
      ]);
    } else if (b.status === 'confirmed') {
      buttons.push([
        Markup.button.callback(`✅ Выполнено #${b.id}`, `bk_done_${b.id}`),
        Markup.button.callback(`❌ Отмена #${b.id}`, `bk_cancel_${b.id}`),
      ]);
    }
  });

  buttons.push([Markup.button.callback('⬅️ К записям', 'adm_bookings')]);
  ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^bk_(confirm|cancel|done)_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const action = ctx.match[1];
  const id = Number(ctx.match[2]);
  const statusMap = { confirm: 'confirmed', cancel: 'cancelled', done: 'done' };
  const labelMap = { confirm: '🟢 Подтверждена', cancel: '🔴 Отменена', done: '✅ Выполнена' };

  bookings.updateStatus(id, statusMap[action]);
  ctx.answerCbQuery(`#${id}: ${labelMap[action]}`);

  // Уведомить клиента
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (booking) {
    const msgs = {
      confirm: `🟢 Ваша запись *#${id}* на "${booking.service_name}" подтверждена!\n📅 ${booking.date} в ${booking.time}`,
      cancel: `🔴 Ваша запись *#${id}* на "${booking.service_name}" отменена.\nСвяжитесь с нами для уточнения.`,
      done: `✅ Запись *#${id}* выполнена! Спасибо, ждём вас снова! 😊`,
    };
    try { await ctx.telegram.sendMessage(booking.user_id, msgs[action], { parse_mode: 'Markdown' }); } catch {}
  }

  ctx.editMessageText(`${labelMap[action]} — запись #${id}`, {
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К записям', 'adm_bookings')]]),
  });
});

// --- ЗАКАЗЫ ---
bot.action('adm_orders', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();

  const list = db.prepare(`
    SELECT o.*, u.first_name, u.last_name, u.username
    FROM orders o LEFT JOIN users u ON o.user_id = u.telegram_id
    ORDER BY o.created_at DESC LIMIT 15
  `).all();

  if (list.length === 0) {
    return ctx.editMessageText('Нет заказов.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]]),
    });
  }

  const statusIcon = { new: '🟡', processing: '🔵', done: '✅', cancelled: '🔴' };
  let text = `🛒 *Заказы:*\n\n`;
  const buttons = [];

  list.forEach((o) => {
    const name = `${o.first_name || ''} ${o.last_name || ''}`.trim() || '—';
    const un = o.username ? ` @${o.username}` : '';
    text += `${statusIcon[o.status] || '⚪'} *#${o.id}*\n`;
    text += `   👤 ${name}${un}\n`;
    text += `   📦 ${o.items}\n`;
    text += `   📍 ${o.address || '—'}\n`;
    if (o.comment) text += `   💬 ${o.comment}\n`;
    text += `\n`;

    if (o.status === 'new') {
      buttons.push([
        Markup.button.callback(`🔵 В работу #${o.id}`, `ord_process_${o.id}`),
        Markup.button.callback(`❌ Отмена #${o.id}`, `ord_cancel_${o.id}`),
      ]);
    } else if (o.status === 'processing') {
      buttons.push([Markup.button.callback(`✅ Выполнен #${o.id}`, `ord_done_${o.id}`)]);
    }
  });

  buttons.push([Markup.button.callback('⬅️ Назад', 'adm_back')]);
  ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^ord_(process|cancel|done)_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  const action = ctx.match[1];
  const id = Number(ctx.match[2]);
  const statusMap = { process: 'processing', cancel: 'cancelled', done: 'done' };
  const labelMap = { process: '🔵 В работе', cancel: '🔴 Отменён', done: '✅ Выполнен' };

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(statusMap[action], id);
  ctx.answerCbQuery(`#${id}: ${labelMap[action]}`);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (order) {
    const msgs = {
      process: `🔵 Ваш заказ *#${id}* принят в работу!`,
      cancel: `🔴 Ваш заказ *#${id}* отменён.`,
      done: `✅ Ваш заказ *#${id}* выполнен! Спасибо! 😊`,
    };
    try { await ctx.telegram.sendMessage(order.user_id, msgs[action], { parse_mode: 'Markdown' }); } catch {}
  }

  ctx.editMessageText(`${labelMap[action]} — заказ #${id}`, {
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К заказам', 'adm_orders')]]),
  });
});

// --- ЗАЯВКИ ---
bot.action('adm_requests', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();

  const list = db.prepare(`
    SELECT r.*, u.first_name, u.last_name, u.username
    FROM requests r LEFT JOIN users u ON r.user_id = u.telegram_id
    ORDER BY r.created_at DESC LIMIT 15
  `).all();

  if (list.length === 0) {
    return ctx.editMessageText('Нет заявок.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]]),
    });
  }

  let text = `📩 *Заявки:*\n\n`;
  const buttons = [];

  list.forEach((r) => {
    const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—';
    const un = r.username ? ` @${r.username}` : '';
    const icon = r.status === 'new' ? '🟡' : '✅';
    text += `${icon} *#${r.id}*\n   👤 ${name}${un}\n   💬 ${r.message}\n\n`;

    if (r.status === 'new') {
      buttons.push([Markup.button.callback(`✅ Обработано #${r.id}`, `req_done_${r.id}`)]);
    }
  });

  buttons.push([Markup.button.callback('⬅️ Назад', 'adm_back')]);
  ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^req_done_(\d+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  db.prepare("UPDATE requests SET status = 'done' WHERE id = ?").run(Number(ctx.match[1]));
  ctx.answerCbQuery('Обработано');
  ctx.editMessageText(`✅ Заявка #${ctx.match[1]} обработана.`, {
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ К заявкам', 'adm_requests')]]),
  });
});

// --- КЛИЕНТЫ ---
bot.action('adm_clients', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();

  const list = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM bookings WHERE user_id = u.telegram_id) as bk,
      (SELECT COUNT(*) FROM orders WHERE user_id = u.telegram_id) as ord
    FROM users u ORDER BY u.created_at DESC LIMIT 20
  `).all();

  if (list.length === 0) {
    return ctx.editMessageText('Нет клиентов.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]]),
    });
  }

  let text = `👥 *Клиенты (${list.length}):*\n\n`;
  list.forEach((u, i) => {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || '—';
    const un = u.username ? ` @${u.username}` : '';
    text += `*${i + 1}. ${name}*${un}\n`;
    if (u.phone) text += `   📱 ${u.phone}\n`;
    text += `   📅 ${u.bk} записей | 🛒 ${u.ord} заказов\n\n`;
  });

  ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]]),
  });
});

// --- УПРАВЛЕНИЕ УСЛУГАМИ ---
function renderServicesList(ctx) {
  const list = db.prepare('SELECT * FROM services ORDER BY id').all();

  let text = `📋 *Управление услугами:*\n\n`;
  const buttons = [];

  list.forEach((s) => {
    const status = s.active ? '🟢' : '🔴';
    const price = s.price > 0 ? `${s.price} ₽` : 'Бесплатно';
    text += `${status} *${s.name}* — ${price}\n`;
    buttons.push([
      Markup.button.callback(`✏️ ${s.name}`, `svc_edit_${s.id}`),
      Markup.button.callback(s.active ? '🔴 Выкл' : '🟢 Вкл', `svc_toggle_${s.id}`),
      Markup.button.callback('🗑', `svc_del_${s.id}`),
    ]);
  });

  if (list.length > 0) text += `\n_🟢 активна | 🔴 скрыта_`;

  buttons.push([Markup.button.callback('➕ Добавить услугу', 'svc_add')]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'adm_back')]);

  return { text, buttons };
}

bot.action('adm_services', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();
  const { text, buttons } = renderServicesList(ctx);
  ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^svc_toggle_(\d+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number(ctx.match[1]);
  const svc = services.getById(id);
  if (!svc) return ctx.answerCbQuery('Не найдено');

  db.prepare('UPDATE services SET active = ? WHERE id = ?').run(svc.active ? 0 : 1, id);
  ctx.answerCbQuery(svc.active ? 'Скрыта' : 'Включена');

  const { text, buttons } = renderServicesList(ctx);
  ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^svc_del_(\d+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  const svc = services.getById(Number(ctx.match[1]));
  if (!svc) return ctx.answerCbQuery('Не найдено');

  ctx.answerCbQuery();
  ctx.editMessageText(`🗑 Удалить *"${svc.name}"*?`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, удалить', `svc_delok_${svc.id}`)],
      [Markup.button.callback('❌ Нет', 'adm_services')],
    ]),
  });
});

bot.action(/^svc_delok_(\d+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  db.prepare('DELETE FROM services WHERE id = ?').run(Number(ctx.match[1]));
  ctx.answerCbQuery('Удалено');
  const { text, buttons } = renderServicesList(ctx);
  ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('svc_add', (ctx) => {
  if (!isAdmin(ctx)) return;
  const session = getSession(ctx);
  session.step = 'svc_add_name';
  session.newService = {};
  ctx.answerCbQuery();
  ctx.editMessageText('➕ *Новая услуга*\n\nНапишите *название*:', { parse_mode: 'Markdown' });
});

bot.action(/^svc_edit_(\d+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  const svc = services.getById(Number(ctx.match[1]));
  if (!svc) return ctx.answerCbQuery('Не найдено');

  ctx.answerCbQuery();
  ctx.editMessageText(
    `✏️ *${svc.name}*\n\n💰 ${svc.price} ₽\n⏱ ${svc.duration} мин\n📝 ${svc.description || '—'}\n\nЧто изменить?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📝 Название', `sch_name_${svc.id}`), Markup.button.callback('💰 Цена', `sch_price_${svc.id}`)],
        [Markup.button.callback('⏱ Время', `sch_dur_${svc.id}`), Markup.button.callback('📋 Описание', `sch_desc_${svc.id}`)],
        [Markup.button.callback('⬅️ К услугам', 'adm_services')],
      ]),
    }
  );
});

bot.action(/^sch_(name|price|dur|desc)_(\d+)$/, (ctx) => {
  if (!isAdmin(ctx)) return;
  const field = ctx.match[1];
  const id = Number(ctx.match[2]);
  const session = getSession(ctx);

  const prompts = { name: 'новое *название*:', price: 'новую *цену* (число):', dur: '*длительность* в минутах:', desc: 'новое *описание*:' };
  session.step = `svc_upd_${field}`;
  session.editServiceId = id;
  ctx.answerCbQuery();
  ctx.editMessageText(`Напишите ${prompts[field]}`, { parse_mode: 'Markdown' });
});

// --- РАССЫЛКА ---
bot.action('adm_broadcast', (ctx) => {
  if (!isAdmin(ctx)) return;
  const session = getSession(ctx);
  session.step = 'broadcast';
  ctx.answerCbQuery();
  ctx.editMessageText('📣 *Рассылка*\n\nНапишите текст — его получат все пользователи:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'adm_back')]]),
  });
});

// --- НАСТРОЙКИ ---
bot.action('adm_settings', (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.answerCbQuery();
  ctx.editMessageText(
    `⚙️ *Настройки*\n\n` +
      `📛 Название: ${BUSINESS_NAME}\n` +
      `🆔 Admin ID: ${ADMIN_ID}\n\n` +
      `_Изменить → файл .env на сервере → pm2 restart telegram-bot_`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', 'adm_back')]]) }
  );
});

// =============================================
// ОБРАБОТКА ТЕКСТА
// =============================================
bot.on('text', async (ctx) => {
  const session = getSession(ctx);
  const text = ctx.message.text;

  // --- Клиентские шаги ---
  if (session.step === 'booking_date' && session.booking) {
    session.booking.date = text;
    session.step = 'booking_time';
    return ctx.reply(`📅 Дата: *${text}*\n\n⏰ Напишите *время* (например: 14:00):`, { parse_mode: 'Markdown' });
  }

  if (session.step === 'booking_time' && session.booking) {
    session.booking.time = text;
    session.step = 'booking_comment';
    return ctx.reply(`⏰ Время: *${text}*\n\n💬 Комментарий?`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Пропустить →', 'no_comment')]]),
    });
  }

  if (session.step === 'booking_comment' && session.booking) {
    session.booking.comment = text;
    return finishBooking(ctx);
  }

  if (session.step === 'order_items') {
    session.order = { items: text };
    session.step = 'order_address';
    return ctx.reply('📍 Адрес доставки (или "самовывоз"):');
  }

  if (session.step === 'order_address') {
    session.order.address = text;
    session.step = 'order_comment';
    return ctx.reply('💬 Комментарий?', {
      ...Markup.inlineKeyboard([[Markup.button.callback('Пропустить →', 'no_order_comment')]]),
    });
  }

  if (session.step === 'order_comment') {
    session.order.comment = text;
    return finishOrder(ctx);
  }

  if (session.step === 'request_message') {
    const reqId = requests.create(ctx.from.id, 'general', text);
    session.step = null;
    ctx.reply(`✅ *Заявка #${reqId} принята!* Мы свяжемся с вами.`, { parse_mode: 'Markdown' });
    return notifyAdmin(ctx, `📩 *Новая заявка #${reqId}*\n\n👤 ${getUserLabel(ctx.from)}\n💬 ${text}`);
  }

  // --- Админские шаги ---
  if (!isAdmin(ctx)) return;

  // Добавление услуги
  if (session.step === 'svc_add_name') {
    session.newService.name = text;
    session.step = 'svc_add_price';
    return ctx.reply('💰 Цена (число, 0 = бесплатно):');
  }
  if (session.step === 'svc_add_price') {
    session.newService.price = Number(text) || 0;
    session.step = 'svc_add_duration';
    return ctx.reply('⏱ Длительность в минутах:');
  }
  if (session.step === 'svc_add_duration') {
    session.newService.duration = Number(text) || 60;
    session.step = 'svc_add_desc';
    return ctx.reply('📝 Описание (или "-" чтобы пропустить):');
  }
  if (session.step === 'svc_add_desc') {
    const svc = session.newService;
    svc.description = text === '-' ? '' : text;
    db.prepare('INSERT INTO services (name, description, price, duration) VALUES (?, ?, ?, ?)').run(svc.name, svc.description, svc.price, svc.duration);
    session.step = null;
    session.newService = null;
    return ctx.reply(`✅ Услуга *"${svc.name}"* добавлена! (${svc.price} ₽, ${svc.duration} мин)`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('📋 К услугам', 'adm_services'), Markup.button.callback('➕ Ещё', 'svc_add')]]),
    });
  }

  // Редактирование услуги
  if (session.step?.startsWith('svc_upd_') && session.editServiceId) {
    const field = session.step.replace('svc_upd_', '');
    const id = session.editServiceId;
    const colMap = { name: 'name', price: 'price', dur: 'duration', desc: 'description' };
    const value = (field === 'price' || field === 'dur') ? (Number(text) || 0) : text;

    db.prepare(`UPDATE services SET ${colMap[field]} = ? WHERE id = ?`).run(value, id);
    session.step = null;
    session.editServiceId = null;
    return ctx.reply('✅ Обновлено!', {
      ...Markup.inlineKeyboard([[Markup.button.callback('📋 К услугам', 'adm_services')]]),
    });
  }

  // Рассылка
  if (session.step === 'broadcast') {
    session.step = null;
    const allUsers = db.prepare('SELECT telegram_id FROM users').all();
    let sent = 0, failed = 0;
    for (const u of allUsers) {
      try { await ctx.telegram.sendMessage(u.telegram_id, text); sent++; } catch { failed++; }
    }
    return ctx.reply(`📣 Рассылка завершена!\n✅ Доставлено: ${sent}\n❌ Ошибок: ${failed}`);
  }
});

// =============================================
// ВСПОМОГАТЕЛЬНЫЕ
// =============================================

function getUserLabel(from) {
  const name = `${from.first_name || ''} ${from.last_name || ''}`.trim() || 'Неизвестный';
  return from.username ? `${name} @${from.username}` : name;
}

async function finishBooking(ctx) {
  const session = getSession(ctx);
  const b = session.booking;
  const bookingId = bookings.create(ctx.from.id, b.serviceId, b.serviceName, b.date, b.time, b.comment);
  session.step = null;
  session.booking = null;

  ctx.reply(
    `✅ *Вы записаны!*\n\n📋 ${b.serviceName}\n📅 ${b.date} в ${b.time}` +
      (b.comment ? `\n💬 ${b.comment}` : '') + `\n\n📌 #${bookingId} — подтвердим!`,
    { parse_mode: 'Markdown' }
  );

  return notifyAdmin(ctx,
    `📅 *Новая запись #${bookingId}*\n\n👤 ${getUserLabel(ctx.from)}\n📋 ${b.serviceName}\n📅 ${b.date} в ${b.time}` +
      (b.comment ? `\n💬 ${b.comment}` : ''),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Подтвердить', `bk_confirm_${bookingId}`)],
      [Markup.button.callback('❌ Отменить', `bk_cancel_${bookingId}`)],
    ])
  );
}

async function finishOrder(ctx) {
  const session = getSession(ctx);
  const o = session.order;
  const orderId = orders.create(ctx.from.id, o.items, 0, o.address, o.comment);
  session.step = null;
  session.order = null;

  ctx.reply(
    `✅ *Заказ #${orderId}*\n\n📦 ${o.items}\n📍 ${o.address}` +
      (o.comment ? `\n💬 ${o.comment}` : '') + `\n\nСвяжемся для подтверждения!`,
    { parse_mode: 'Markdown' }
  );

  return notifyAdmin(ctx,
    `🛒 *Новый заказ #${orderId}*\n\n👤 ${getUserLabel(ctx.from)}\n📦 ${o.items}\n📍 ${o.address}` +
      (o.comment ? `\n💬 ${o.comment}` : '')
  );
}

async function notifyAdmin(ctx, text, extra = {}) {
  if (!ADMIN_ID) return;
  try { await ctx.telegram.sendMessage(ADMIN_ID, text, { parse_mode: 'Markdown', ...extra }); } catch (e) {
    console.error('Ошибка уведомления:', e.message);
  }
}

// === ЗАПУСК ===
bot.launch().then(() => {
  console.log(`🤖 Бот "${BUSINESS_NAME}" запущен!`);
  console.log(`📊 Admin: ${ADMIN_ID}`);
}).catch((err) => { console.error('Ошибка:', err); process.exit(1); });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
