/**
 * lightweight-charts formats all axis/crosshair times using the BROWSER's local timezone by
 * default — there's no automatic notion of "the market's own timezone." Every candle in this app
 * is a raw IST-market timestamp, so without this, a viewer whose machine isn't set to IST sees
 * every time label offset from the real market time (the whole session looks wrong, not just part
 * of it, since it's a constant offset). Shared by every lightweight-charts instance in the app
 * (CandlesChart.tsx, BacktestLab.tsx) so the fix can't drift between them.
 */
import { TickMarkType, type Time } from "lightweight-charts";

function formatIst(timeSec: number, opts: Intl.DateTimeFormatOptions): string {
  return new Date(timeSec * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });
}

export function istTickMarkFormatter(time: Time, tickMarkType: TickMarkType): string {
  const timeSec = time as number;
  switch (tickMarkType) {
    case TickMarkType.Year:
      return formatIst(timeSec, { year: "numeric" });
    case TickMarkType.Month:
      return formatIst(timeSec, { month: "short" });
    case TickMarkType.DayOfMonth:
      return formatIst(timeSec, { day: "numeric", month: "short" });
    case TickMarkType.TimeWithSeconds:
      return formatIst(timeSec, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    default:
      return formatIst(timeSec, { hour: "2-digit", minute: "2-digit", hour12: false });
  }
}

export function istTimeFormatter(time: Time): string {
  return formatIst(time as number, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}
