https://vercel.com/tantiks-projects
https://supabase.com/dashboard/project/bhqgfszxiuqmwojhpvne
https://github.com/tantik/line-app.git
Я продолжаю проект LINE Mini App для записи в салоны в Японии.

ВАЖНОЕ ПРАВИЛО РАБОТЫ:
1. Перед любым советом по коду обязательно проверить актуальный GitHub:
   https://github.com/tantik/line-app.git
2. Если меняется JS/HTML/CSS — давать полный файл целиком, а не куски.
3. Перед отправкой кода обязательно проверить синтаксис и логику.
4. Не удалять уже реализованные функции.
5. Не присылать скачиваемые файлы — код только прямо в чат.
6. Я новичок, объяснять просто и пошагово.
7. Отвечать по-русски.

Цель проекта:
Мы делаем полностью рабочую демо-версию LINE Mini App SaaS для салонов в Японии.
Демо должно работать как реальный продукт:
- клиент открывает Mini App через LINE/браузер;
- выбирает услугу;
- выбирает мастера;
- выбирает дату;
- видит только реальные доступные слоты;
- отправляет запись;
- салон управляет всем через SaaS-админку.

Демо используется для показа клиентам и потом быстро превращается в коммерческую версию.

Стек:
- Frontend: HTML/CSS/JS на Vercel
- LIFF / LINE Login
- Backend: Supabase Postgres + RPC
- Storage: Supabase Storage
- Основной data flow: frontend → Supabase
- Google Apps Script больше НЕ используем

Репозиторий:
https://github.com/tantik/line-app.git

Текущие таблицы Supabase:
- salons
- salon_members
- services
- staff
- staff_service_map
- bookings
- booking_events
- reminder_jobs
- reminder_rules
- salon_settings
- leads
- admin_booking_view
- blocked_slots
- business_hours
- profiles

ВАЖНО:
- Правильная таблица связи мастер ↔ услуга: staff_service_map
- Таблица staff_services лишняя/тестовая, её не использовать
- В staff обязательные поля: slot_minutes, start_time, end_time
- В services есть: salon_id, code, name, description, duration_minutes, price_jpy, category, sort_order, is_active
- salon_id демо-салона:
  e840e2b0-2d49-4899-b6d2-f2afe895ad1e
- salon slug:
  mirawi-demo

Текущий пользователь в salon_members:
- salon_id: e840e2b0-2d49-4899-b6d2-f2afe895ad1e
- user_id: d3f4624b-1d41-4711-aa94-ca3063695b3c
- role: salon_admin
- salon: Mirawi Demo Salon / mirawi-demo

Что уже сделано:
- Убрали GAS / WEBHOOK_URL
- Настроили Supabase Auth
- Временно простые allow all policies для разработки
- Staff CRUD работает
- Services CRUD работает
- Bookings в админке есть
- Связь staff ↔ services через staff_service_map работает
- Supabase Storage bucket salon-assets создан
- Фото staff загружаются через Storage
- В admin.html убрали ручной 写真URL, оставили загрузку фото
- business_hours создана и заполнена
- available_slots_v2 создана и в SQL работает

business_hours сейчас:
- 0 воскресенье: closed
- 1–6: 10:00–19:00
- salon_id: e840e2b0-2d49-4899-b6d2-f2afe895ad1e

SQL-функция available_slots_v2 уже работает.
Пример результата SQL:
["10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30"]

Проверенные реальные staff:
- Ayano: 451adc3a-84d9-4e2f-be55-b0eecc1ca126
- dara: 4842e5df-bdc2-46de-a098-add0538a8e3a
- Haruka: a090d547-f413-4c1b-8732-9e23f7eb04c2
- Kento: 4dfbc6bd-d015-46d7-8176-141e5143437b
- Noa: e2c66985-1440-4f01-9d3a-794238e6a7f2
- Rina: 3137d017-d4ab-43f2-bb5f-0b81413fd545
- Sora: 31b3ed3f-8aa4-4f19-9d0e-20644843589a

Проверенная связь staff_service_map:
- Haruka поддерживает 前髪カット
- Haruka + 前髪カット + 2026-05-01 в SQL возвращает слоты
- Значит backend работает, проблема сейчас во frontend/script.js или в DOM/UI-логике отображения времени.

Текущая проблема:
На frontend время НЕ появляется.
В UI после выбора услуги/мастера/даты показывает:
「この日に利用できる時間がありません」
Хотя SQL available_slots_v2 возвращает слоты.

Последний debug/code был приложен в старом чате как текст. В нём script.js:
- грузит services/staff напрямую из Supabase
- hydrateStaffServiceMap делает staff_service_map
- вызывает available_slots_v2
- есть debug:
  [Mirawi Debug] calling available_slots_v2
  [Mirawi Debug] available_slots_v2 response
  [Mirawi Debug] merged available slots
Но время всё равно не отображается.

Нужно в новом чате:
1. Сначала проверить GitHub перед ответом.
2. Проверить актуальные index.html, script.js, src/supabase-client.js, src/env.js.
3. Понять, почему frontend не показывает slots, хотя SQL available_slots_v2 работает.
4. Особенно проверить:
   - реальные id DOM элементов: timeList, inlineTimeLoading, slotHint, staffListStep2, servicesList, dateList
   - не отличается ли index.html от ожиданий script.js
   - не перерисовывается ли состояние после получения slots
   - не очищается ли availableSlotsState после RPC
   - не блокируются ли все слоты функцией isTimeBlockedByNow
   - корректно ли selectedService.serviceId / selectedStaff.staffId / selectedDate передаются в RPC
   - нет ли кэша старого script.js в браузере/Vercel
   - точно ли в GitHub лежит полный свежий script.js, а не сжатый/битый старый файл
5. Дать полный исправленный script.js целиком.
6. Если нужен index.html — дать полный index.html целиком.
7. Перед отправкой проверить, что ничего не удалено:
   - LIFF/dev mode
   - leads form
   - create_public_lead
   - create_public_booking
   - service selection
   - staff selection
   - date selection
   - real slots through available_slots_v2
   - phone validation
   - success screen
   - admin link
8. После исправления перейти к blocked_slots, LINE confirmation/cancellation, reminder_jobs и no-show reduction.

Текущий следующий шаг:
Исправить frontend так, чтобы реальные слоты из available_slots_v2 отображались в клиентском интерфейсе.