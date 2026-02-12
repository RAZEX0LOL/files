const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));

// Включаем WAL для производительности
db.pragma('journal_mode = WAL');

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 60,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service_id INTEGER,
    service_name TEXT,
    date TEXT,
    time TEXT,
    status TEXT DEFAULT 'new',
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    items TEXT,
    total INTEGER DEFAULT 0,
    address TEXT,
    status TEXT DEFAULT 'new',
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT DEFAULT 'general',
    message TEXT,
    status TEXT DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );
`);

// Добавляем демо-услуги если таблица пустая
const serviceCount = db.prepare('SELECT COUNT(*) as count FROM services').get();
if (serviceCount.count === 0) {
  const insertService = db.prepare(
    'INSERT INTO services (name, description, price, duration) VALUES (?, ?, ?, ?)'
  );

  const demoServices = [
    ['Стрижка мужская', 'Классическая мужская стрижка', 1500, 45],
    ['Стрижка женская', 'Стрижка + укладка', 2500, 60],
    ['Окрашивание', 'Окрашивание волос любой сложности', 4000, 120],
    ['Маникюр', 'Маникюр с покрытием гель-лак', 2000, 90],
    ['Консультация', 'Бесплатная консультация по услугам', 0, 30],
  ];

  const insertMany = db.transaction((services) => {
    for (const s of services) {
      insertService.run(...s);
    }
  });

  insertMany(demoServices);
}

// === ХЕЛПЕРЫ ===

const users = {
  upsert(telegramId, username, firstName, lastName) {
    db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name
    `).run(telegramId, username, firstName, lastName);
  },

  get(telegramId) {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  },

  updatePhone(telegramId, phone) {
    db.prepare('UPDATE users SET phone = ? WHERE telegram_id = ?').run(phone, telegramId);
  },

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  },
};

const services = {
  getAll() {
    return db.prepare('SELECT * FROM services WHERE active = 1').all();
  },

  getById(id) {
    return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
  },
};

const bookings = {
  create(userId, serviceId, serviceName, date, time, comment) {
    const result = db.prepare(`
      INSERT INTO bookings (user_id, service_id, service_name, date, time, comment)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, serviceId, serviceName, date, time, comment);
    return result.lastInsertRowid;
  },

  getByUser(userId) {
    return db.prepare(
      'SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
    ).all(userId);
  },

  getNew() {
    return db.prepare("SELECT * FROM bookings WHERE status = 'new' ORDER BY created_at DESC").all();
  },

  updateStatus(id, status) {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
  },

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM bookings').get().count;
  },
};

const orders = {
  create(userId, items, total, address, comment) {
    const result = db.prepare(`
      INSERT INTO orders (user_id, items, total, address, comment)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, items, total, address, comment);
    return result.lastInsertRowid;
  },

  getByUser(userId) {
    return db.prepare(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
    ).all(userId);
  },

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  },
};

const requests = {
  create(userId, type, message) {
    const result = db.prepare(`
      INSERT INTO requests (user_id, type, message) VALUES (?, ?, ?)
    `).run(userId, type, message);
    return result.lastInsertRowid;
  },

  count() {
    return db.prepare('SELECT COUNT(*) as count FROM requests').get().count;
  },
};

module.exports = { db, users, services, bookings, orders, requests };
