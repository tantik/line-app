Главная причина: available_slots_v2 может возвращать слот не как строку, а как объект типа { available_slots_v2: "10:00" }. Текущий код это не читает, поэтому UI думает, что слотов нет.

Замени только функцию fetchAvailableSlotsForStaff и добавь рядом новую функцию extractSlotTime. Полный файл из GitHub слишком большой для безопасной вставки целиком здесь без риска обрезания, поэтому даю точечную замену, которая не ломает остальное.
function extractSlotTime(item) {
  if (typeof item === "string") return item;

  if (!item || typeof item !== "object") return "";

  return (
    item.time ||
    item.start_time ||
    item.slot_time ||
    item.available_slots_v2 ||
    item.available_slot ||
    item.slot ||
    Object.values(item).find((value) => typeof value === "string" && /^\d{1,2}:\d{2}/.test(value)) ||
    ""
  );
}

async function fetchAvailableSlotsForStaff(member) {
  if (!selectedService || !selectedDate || !member?.staffId) return [];

  const sb = getSupabase();
  if (!sb) throw new Error("Supabase client is not available");

  const activeSalonId = await resolveSalonIdFromDatabase();

  debugLog("calling available_slots_v2", {
    p_salon_id: activeSalonId,
    p_staff_id: member.staffId,
    staff_name: member.name,
    p_service_id: selectedService.serviceId,
    service_name: selectedService.name,
    p_date: selectedDate,
  });

  const { data, error } = await sb.rpc("available_slots_v2", {
    p_salon_id: activeSalonId,
    p_staff_id: member.staffId,
    p_service_id: selectedService.serviceId,
    p_date: selectedDate,
  });

  debugLog("available_slots_v2 response", {
    staff: member.name,
    rawData: data,
    error,
  });

  if (error) throw error;

  const rawSlots = normalizeRpcSlots(data);

  const slots = rawSlots
    .map((item) => normalizeTime(extractSlotTime(item)))
    .filter(Boolean)
    .map((time) => ({
      time,
      staffIds: [String(member.staffId)],
    }));

  debugLog("normalized slots for staff", {
    staff: member.name,
    slots,
  });

  return slots;
}