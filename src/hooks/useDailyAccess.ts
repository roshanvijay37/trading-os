import { storage } from "../services/storage";
import { toLocalDateKey } from "../utils/date";

export function useDailyAccess() {
  const today = toLocalDateKey();
  const settings = storage.getSettings();
  const tradesToday = storage.getTradesForDate(today);

  return {
    today,
    constitutionAccepted: storage.hasAcceptedConstitution(today),
    tradeLocked: tradesToday.length >= settings.maxTradesPerDay,
    tradesToday,
  };
}
