/**
 * Generates a shareable PDF performance report from a completed backtest result.
 *
 * Deliberately excludes anything that would reveal HOW the strategy works: no strategy name,
 * no timeframe/resolution, no EMA/rule/entry-exit mechanics, no exit-reason breakdown (reveals
 * exit structure), no hour-of-day/day-of-week breakdown (reveals timing), and no per-trade log
 * (entry/exit prices could let a reader reverse-engineer the signal). Only aggregate performance
 * numbers, a generic instrument name, the tested date range, and the equity curve shape.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface BacktestSummary {
  totalTrades: number;
  winRate: number;
  totalReturn: number;
  totalPnL: number;
  maxDrawdown: number;
  profitFactor: number;
  payoffRatio: number;
  avgWin: number;
  avgLoss: number;
  finalCapital: number;
}

interface BacktestAdvanced {
  streaks: {
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    currentStreak: number;
  };
  extremes: { largestWin: number; largestLoss: number };
  rMultiple: { avg: number; min: number; max: number; coveredTrades: number };
  riskAdjusted: { sharpe: number; sortino: number; cagr: number; calmar: number; recoveryFactor: number };
  kellyPercent: number;
  yearly: { year: string; trades: number; winRate: number; totalPnL: number }[];
}

interface EquityPoint {
  date: string;
  equity: number;
}

export interface BacktestReportInput {
  summary: BacktestSummary;
  advanced?: BacktestAdvanced;
  equityCurve: EquityPoint[];
  symbol: string; // raw FYERS symbol, e.g. "NSE:NIFTYBANK-INDEX" — mapped to a friendly name below
  fromDate: string;
  toDate: string;
  capital: number;
}

const FRIENDLY_INSTRUMENT: Record<string, string> = {
  "NSE:NIFTYBANK-INDEX": "Bank Nifty",
  "NSE:NIFTY50-INDEX": "Nifty 50",
};

// Exported (not just internal) so the "no strategy details" mapping can be unit-tested directly.
export function friendlyInstrument(symbol: string): string {
  return FRIENDLY_INSTRUMENT[symbol] || "Index";
}

export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// Draws the equity curve as a simple line chart on an offscreen canvas and returns a PNG data
// URL — this is the only visual in the report, and only shows capital growth over time (no
// strategy mechanics are inferable from an equity curve's shape alone).
function renderEquityCurvePng(equityCurve: EquityPoint[], widthPx = 900, heightPx = 320): string | null {
  if (!equityCurve || equityCurve.length < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const padding = 40;
  const values = equityCurve.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  // Axes
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, heightPx - padding);
  ctx.lineTo(widthPx - padding, heightPx - padding);
  ctx.stroke();

  // Equity line
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  equityCurve.forEach((p, i) => {
    const x = padding + (i / (equityCurve.length - 1)) * (widthPx - padding * 2);
    const y = heightPx - padding - ((p.equity - min) / range) * (heightPx - padding * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Min/max labels
  ctx.fillStyle = "#666666";
  ctx.font = "12px sans-serif";
  ctx.fillText(inr(max), padding + 4, padding + 12);
  ctx.fillText(inr(min), padding + 4, heightPx - padding - 4);

  return canvas.toDataURL("image/png");
}

export function downloadBacktestPdf(input: BacktestReportInput) {
  const { summary, advanced, equityCurve, symbol, fromDate, toDate, capital } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  let y = 50;

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Trading Performance Report", marginX, y);
  y += 22;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`, marginX, y);
  y += 24;

  doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text(`Instrument: ${friendlyInstrument(symbol)}`, marginX, y);
  y += 16;
  doc.text(`Period tested: ${fromDate} to ${toDate}`, marginX, y);
  y += 16;
  doc.text(`Starting capital: ${inr(capital)}`, marginX, y);
  y += 24;

  autoTable(doc, {
    startY: y,
    head: [["Headline", "Value"]],
    body: [
      ["Total trades", String(summary.totalTrades)],
      ["Win rate", `${summary.winRate.toFixed(1)}%`],
      ["Total return", pct(summary.totalReturn)],
      ["Final capital", inr(summary.finalCapital)],
      ["Max drawdown", `${summary.maxDrawdown.toFixed(2)}%`],
      ["Profit factor (gross profit / gross loss)", summary.profitFactor.toFixed(2)],
      ["Payoff ratio (avg win / avg loss)", summary.payoffRatio.toFixed(2)],
    ],
    theme: "striped",
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 10 },
  });
  // jspdf-autotable sets `lastAutoTable` on the doc instance as a side effect at runtime; cast
  // through `any` rather than relying on its type augmentation being picked up a specific way.
  y = (doc as any).lastAutoTable.finalY + 24;

  if (advanced) {
    autoTable(doc, {
      startY: y,
      head: [["Risk-Adjusted Performance", "Value"]],
      body: [
        ["Sharpe ratio", advanced.riskAdjusted.sharpe.toFixed(2)],
        ["Sortino ratio", advanced.riskAdjusted.sortino.toFixed(2)],
        ["CAGR", `${advanced.riskAdjusted.cagr.toFixed(2)}%`],
        ["Calmar ratio", advanced.riskAdjusted.calmar.toFixed(2)],
        ["Recovery factor", advanced.riskAdjusted.recoveryFactor.toFixed(2)],
        ["Avg R-multiple", `${advanced.rMultiple.avg >= 0 ? "+" : ""}${advanced.rMultiple.avg.toFixed(2)}R`],
      ],
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 10 },
    });
    y = (doc as any).lastAutoTable.finalY + 24;

    autoTable(doc, {
      startY: y,
      head: [["Trade Distribution", "Value"]],
      body: [
        ["Avg win", inr(summary.avgWin)],
        ["Avg loss", inr(summary.avgLoss)],
        ["Largest win", inr(advanced.extremes.largestWin)],
        ["Largest loss", inr(advanced.extremes.largestLoss)],
        ["Max consecutive wins", String(advanced.streaks.maxConsecutiveWins)],
        ["Max consecutive losses", String(advanced.streaks.maxConsecutiveLosses)],
      ],
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 10 },
    });
    y = (doc as any).lastAutoTable.finalY + 24;
  }

  const chartPng = renderEquityCurvePng(equityCurve);
  if (chartPng) {
    if (y > 620) {
      doc.addPage();
      y = 50;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Equity Curve", marginX, y);
    y += 10;
    const imgWidth = 515;
    const imgHeight = (320 / 900) * imgWidth;
    doc.addImage(chartPng, "PNG", marginX, y, imgWidth, imgHeight);
    y += imgHeight + 24;
  }

  if (advanced && advanced.yearly.length > 1) {
    if (y > 650) {
      doc.addPage();
      y = 50;
    }
    autoTable(doc, {
      startY: y,
      head: [["Year", "Trades", "Win Rate", "P&L"]],
      body: advanced.yearly.map((row) => [row.year, String(row.trades), `${row.winRate.toFixed(1)}%`, inr(row.totalPnL)]),
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 10 },
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(
      "Simulated/backtested performance. Past results do not guarantee future returns. Not investment advice.",
      marginX,
      812
    );
  }

  doc.save(`backtest-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
