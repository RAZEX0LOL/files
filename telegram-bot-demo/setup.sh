#!/bin/bash

# ============================================
# Установка Telegram-бота на Ubuntu Server
# ============================================

set -e

echo "🚀 Установка Telegram-бота..."
echo "================================"

# 1. Обновляем систему
echo "📦 Обновление системы..."
sudo apt update && sudo apt upgrade -y

# 2. Устанавливаем Node.js 20 LTS
echo "📦 Установка Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "   Node.js уже установлен: $(node -v)"
fi

# 3. Устанавливаем build-essential (для native модулей)
echo "📦 Установка build-essential..."
sudo apt install -y build-essential python3

# 4. Устанавливаем PM2 глобально
echo "📦 Установка PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo "   PM2 уже установлен"
fi

# 5. Создаём директорию для бота
BOT_DIR="$HOME/telegram-bot"
echo "📁 Создание директории $BOT_DIR..."
mkdir -p "$BOT_DIR"

# Копируем файлы если запущен из директории с ботом
if [ -f "bot.js" ]; then
    cp -r ./* "$BOT_DIR/"
    echo "   Файлы скопированы"
fi

cd "$BOT_DIR"

# 6. Устанавливаем зависимости
echo "📦 Установка npm-зависимостей..."
npm install

# 7. Настраиваем .env
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo ""
        echo "⚠️  ВАЖНО! Отредактируй файл .env:"
        echo "   nano $BOT_DIR/.env"
        echo ""
        echo "   Заполни:"
        echo "   BOT_TOKEN=токен_от_BotFather"
        echo "   ADMIN_ID=твой_telegram_id"
        echo ""
    fi
else
    echo "   .env уже существует"
fi

# 8. Настраиваем PM2 для автозапуска
echo "🔄 Настройка автозапуска PM2..."
pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null || true

echo ""
echo "============================================"
echo "✅ Установка завершена!"
echo "============================================"
echo ""
echo "📝 Следующие шаги:"
echo ""
echo "1. Отредактируй .env файл:"
echo "   nano $BOT_DIR/.env"
echo ""
echo "2. Запусти бота:"
echo "   cd $BOT_DIR"
echo "   pm2 start bot.js --name telegram-bot"
echo ""
echo "3. Сохрани автозапуск:"
echo "   pm2 save"
echo ""
echo "4. Полезные команды PM2:"
echo "   pm2 logs telegram-bot   — логи"
echo "   pm2 restart telegram-bot — перезапуск"
echo "   pm2 stop telegram-bot    — остановка"
echo "   pm2 status               — статус"
echo ""
