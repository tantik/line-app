# 🔵 ОДИН: LINE ИНТЕГРАЦИЯ - СТАТУС ПРОВЕРКИ

**Дата создания:** 28 апреля 2026 г.  
**Статус:** ✅ Структура создана, ждёт Vercel конфигурации

---

## ✅ ЧТО СДЕЛАНО

### 1. Обновлена конфигурация
- ✅ `src/env.js` — добавлены LINE_CHANNEL_ID и LINE_WEBHOOK_URL
- ✅ `.env.example` — все LINE параметры задокументированы

### 2. Создана структура webhook
- ✅ `api/line-webhook.js` — Vercel serverless function
  - Проверка подписи LINE (HMAC-SHA256)
  - Обработка постбэк-действий (confirm/cancel)
  - Отправка приветственных сообщений
  - Обработка текстовых сообщений

### 3. Реализована отправка напоминаний
- ✅ `supabase/functions/process-reminders/index.ts` — обновлена
  - Отправка через LINE Messaging API
  - Разные сообщения для разных типов (booking_created, reminder_24h, reminder_3h)
  - Обработка ошибок и retry логика

---

## 🔧 ЧТО ОСТАЛОСЬ (ТВОИ ДЕЙСТВИЯ)

### Шаг 1: Настроить Vercel environment переменные

В https://vercel.com/dashboard добавь переменные:

```
LINE_CHANNEL_SECRET=47e57b0be1271f363d374037a116f0fe
LINE_CHANNEL_ACCESS_TOKEN=5BgAocIICUXkX3ENSSey1RMnPK7uO/yEt/iwGzMwce4Ak9H+87v0MmK5wKTAIVcJNgZHwQUMqdNz/720X9+g5oE1fay063HmshB58K9b5wmatkYKfw1AEKZNe99PNZWdWkwDZDX91b8/wylahNbaDwdB04t89/1O/w1cDnyilFU=
SUPABASE_URL=https://bhqgfszxiuqmwojhpvne.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<твой service role key из Supabase>
```

**Где взять SUPABASE_SERVICE_ROLE_KEY:**
1. Vercel → Settings → Project
2. Environment Variables → добавить SERVICE_ROLE_KEY
3. Или в Supabase Console → Project Settings → API Keys → Service Role

### Шаг 2: Настроить Supabase Secrets

В https://supabase.com/dashboard → Project → Settings → Vault:

```
LINE_CHANNEL_SECRET=47e57b0be1271f363d374037a116f0fe
LINE_CHANNEL_ACCESS_TOKEN=5BgAocIICUXkX3ENSSey1RMnPK7uO/yEt/iwGzMwce4Ak9H+87v0MmK5wKTAIVcJNgZHwQUMqdNz/720X9+g5oE1fay063HmshB58K9b5wmatkYKfw1AEKZNe99PNZWdWkwDZDX91b8/wylahNbaDwdB04t89/1O/w1cDnyilFU=
```

### Шаг 3: Проверить в LINE Developer Console

Webhook Status должен быть **Enabled**

1. https://developers.line.biz/console/channel/2009643805/
2. Webhook URL: https://line-app-xi.vercel.app/api/line-webhook
3. Use webhook: **ON**
4. Verify tokens: нажми "Verify" (должно быть зелёно)

### Шаг 4: Деплой на Vercel

```bash
git add .
git commit -m "Add LINE webhook integration"
git push origin main
```

---

## 🧪 ТЕСТИРОВАНИЕ

### Локальное тестирование webhook
```bash
# Проверка подписи и обработки
curl -X POST http://localhost:3000/api/line-webhook \
  -H "Content-Type: application/json" \
  -H "X-Line-Signature: <signature>" \
  -d '{"events":[{"type":"follow","source":{"userId":"Uxxxxxxxx"}}]}'
```

### Тестирование отправки через LINE
1. Добавь аккаунт Mirawi Salon Demo в LINE
2. Отправь /help или любое сообщение
3. Должно вернуться эхо-сообщение

### Тестирование напоминаний
1. Создай бронирование через демо-приложение
2. Проверь, что в Supabase создалась запись в reminder_jobs
3. Вручную запусти Supabase function:
   ```
   supabase functions invoke process-reminders
   ```
4. Проверь LINE Chat - должно прийти сообщение подтверждения

---

## 📊 СТАТУС БЛОКЕРОВ

| Компонент | Статус | Блокер? |
|-----------|--------|---------|
| Webhook код | ✅ Готово | - |
| Vercel конфиг | ⏳ Ожидается | 🔴 ДА |
| Supabase secrets | ⏳ Ожидается | 🔴 ДА |
| LINE verification | ⏳ Ожидается | 🔴 ДА |
| Напоминания | ✅ Готово | - |

---

## 📋 ПЕРЕДАЧА ЛОКИ

Когда webhook будет настроен, передам Локи:
- [ ] Создание демо-сайта (landing page)
- [ ] Форма обратной связи для лидов
- [ ] UI для супер-админки

**Следующий шаг:** Дай мне SUPABASE_SERVICE_ROLE_KEY и подтверди, что Vercel env переменные добавлены.

---

## 🔍 ПРОВЕРКА ЧЕК-ЛИСТ

### Для проверки LINE интеграции:
1. **Vercel env vars добавлены:**
   - [ ] LINE_CHANNEL_SECRET ✓
   - [ ] LINE_CHANNEL_ACCESS_TOKEN ✓
   - [ ] SUPABASE_SERVICE_ROLE_KEY ✓
   - [ ] SUPABASE_URL ✓

2. **Supabase secrets добавлены:**
   - [ ] LINE_CHANNEL_ACCESS_TOKEN в Settings → Vault

3. **LINE Developer Console:**
   - [ ] Webhook URL: https://line-app-xi.vercel.app/api/line-webhook
   - [ ] Webhook Enabled: ON
   - [ ] Verify token: зелёная галочка

4. **После деплоя проверить:**
   - [ ] Webhook обрабатывает request (проверить logs на Vercel)
   - [ ] Создание бронирования создаёт reminder_jobs
   - [ ] `supabase functions invoke process-reminders` отправляет LINE сообщения
   - [ ] Постбэк-действия обновляют статус бронирования