1. PUBLIC_DEMO_MODE = false
2. Удалить TEMP demo anon policies
3. Настроить Supabase Auth login
4. Создать реального admin user
5. Добавить его в salon_members
6. Проверить RLS для salons / staff / services / bookings / storage
7. Проверить, что service_role нигде не попал во frontend
8. Проверить, что anon key используется только там, где можно
9. Протестировать upload staff/service images под реальным admin
10. Протестировать realtime bookings под реальным admin

Production-безопасность

Нужно будет обязательно убрать demo-костыли перед реальным клиентом:

PUBLIC_DEMO_MODE: true
TEMP demo upload service icons
TEMP demo upload staff photos
TEMP demo select bookings for realtime