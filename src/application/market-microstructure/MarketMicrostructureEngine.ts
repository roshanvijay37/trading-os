import {
  LiquidityZone,
  OrderBookImbalance,
  MarketPressure,
  VWAPDeviation,
  IcebergDetection,
  ExecutionFootprint,
  SweepDetection,
  VolumeProfile,
} from '@domain/market-microstructure/LiquidityMap';
import { EventType } from '@domain/events/TradingEvents';
import { globalEventBus } from '@infrastructure/events/EventBus';

export interface MarketDataTick {
  symbol: string;
  timestamp: string;
  ltp: number;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  volume: number;
  oi?: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orders?: number;
}

export interface OrderBookSnapshot {
  symbol: string;
  timestamp: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export class MarketMicrostructureEngine {
  private orderBookCache = new Map<string, OrderBookSnapshot>();
  private tickHistory = new Map<string, MarketDataTick[]>();
  private readonly maxTickHistory = 5000;
  private liquidityZones = new Map<string, LiquidityZone[]>();
  private volumeProfiles = new Map<string, VolumeProfile>();
  private isRunning = false;
  private analysisInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.analysisInterval = setInterval(() => this.runPeriodicAnalysis(), 1000);
    console.log('[MarketMicrostructureEngine] Started');
  }

  stop(): void {
    this.isRunning = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    console.log('[MarketMicrostructureEngine] Stopped');
  }

  onOrderBookUpdate(snapshot: OrderBookSnapshot): void {
    this.orderBookCache.set(snapshot.symbol, snapshot);
    this.analyzeOrderBook(snapshot);
  }

  onTick(tick: MarketDataTick): void {
    const history = this.tickHistory.get(tick.symbol) || [];
    history.push(tick);
    if (history.length > this.maxTickHistory) history.shift();
    this.tickHistory.set(tick.symbol, history);
  }

  private analyzeOrderBook(snapshot: OrderBookSnapshot): void {
    const imbalance = this.calculateImbalance(snapshot);
    if (imbalance && Math.abs(imbalance.imbalance) > 0.3) {
      globalEventBus.publish(
        globalEventBus.createEvent(
          EventType.SIGNAL_GENERATED,
          { type: 'ORDERBOOK_IMBALANCE', data: imbalance, symbol: snapshot.symbol },
          'MarketMicrostructureEngine',
          snapshot.symbol
        )
      );
    }

    const iceberg = this.detectIceberg(snapshot);
    if (iceberg.detected && iceberg.detectionConfidence > 0.75) {
      globalEventBus.publish(
        globalEventBus.createEvent(
          EventType.LIQUIDITY_VOID_DETECTED,
          iceberg,
          'MarketMicrostructureEngine',
          snapshot.symbol
        )
      );
    }
  }

  private calculateImbalance(snapshot: OrderBookSnapshot): OrderBookImbalance | null {
    if (!snapshot.bids.length || !snapshot.asks.length) return null;

    const bidDepth = snapshot.bids.reduce((sum, b) => sum + b.quantity, 0);
    const askDepth = snapshot.asks.reduce((sum, a) => sum + a.quantity, 0);
    const totalDepth = bidDepth + askDepth;
    if (totalDepth === 0) return null;

    const top10Bid = snapshot.bids.slice(0, 10).reduce((s, b) => s + b.quantity, 0);
    const top10Ask = snapshot.asks.slice(0, 10).reduce((s, a) => s + a.quantity, 0);

    const imbalance = (bidDepth - askDepth) / totalDepth;
    const weightedImbalance = snapshot.bids[0].quantity / (snapshot.bids[0].quantity + snapshot.asks[0].quantity) - 0.5;

    let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (imbalance > 0.4 && weightedImbalance > 0.2) signal = 'bullish';
    else if (imbalance < -0.4 && weightedImbalance < -0.2) signal = 'bearish';

    return {
      symbol: snapshot.symbol,
      timestamp: snapshot.timestamp,
      bidDepth,
      askDepth,
      imbalance,
      weightedImbalance,
      top10BidVolume: top10Bid,
      top10AskVolume: top10Ask,
      largeOrderPressure: Math.max(top10Bid, top10Ask) / totalDepth,
      signal,
      confidence: Math.abs(imbalance),
    };
  }

  private detectIceberg(snapshot: OrderBookSnapshot): IcebergDetection {
    const suspiciousBids = snapshot.bids.filter(
      (b, i) => i < 5 && b.quantity > 0 && b.quantity % 100 === 0
    );
    const suspiciousAsks = snapshot.asks.filter(
      (a, i) => i < 5 && a.quantity > 0 && a.quantity % 100 === 0
    );

    const detected = suspiciousBids.length > 0 || suspiciousAsks.length > 0;
    const side = suspiciousBids.length > suspiciousAsks.length ? 'bid' : 'ask';
    const level = side === 'bid' ? suspiciousBids[0] : suspiciousAsks[0];

    return {
      symbol: snapshot.symbol,
      timestamp: snapshot.timestamp,
      detected,
      icebergPrice: level?.price,
      visibleSize: level?.quantity,
      estimatedTotalSize: level ? level.quantity * 3 : undefined,
      hiddenRatio: level ? 0.67 : undefined,
      detectionConfidence: detected ? 0.6 : 0,
      method: detected ? 'order_lifetime' : undefined,
      evidence: detected ? [`Round lot detected at ${side} ${level?.price}`] : [],
    };
  }

  private runPeriodicAnalysis(): void {
    for (const [symbol, ticks] of this.tickHistory) {
      if (ticks.length < 100) continue;

      const pressure = this.calculateMarketPressure(symbol, ticks);
      if (Math.abs(pressure.pressureRatio) > 2) {
        globalEventBus.publish(
          globalEventBus.createEvent(
            EventType.MARKET_PRESSURE_ALERT,
            pressure,
            'MarketMicrostructureEngine',
            symbol
          )
        );
      }

      const sweep = this.detectSweep(symbol, ticks);
      if (sweep.sweepDetected) {
        globalEventBus.publish(
          globalEventBus.createEvent(
            EventType.SIGNAL_GENERATED,
            { type: 'SWEEP_DETECTED', data: sweep },
            'MarketMicrostructureEngine',
            symbol
          )
        );
      }
    }
  }

  private calculateMarketPressure(symbol: string, ticks: MarketDataTick[]): MarketPressure {
    const recent = ticks.slice(-100);
    const aggressiveBuy = recent.filter((t) => t.ltp >= (t.ask || t.ltp)).reduce((s, t) => s + t.volume, 0);
    const aggressiveSell = recent.filter((t) => t.ltp <= (t.bid || t.ltp)).reduce((s, t) => s + t.volume, 0);
    const total = aggressiveBuy + aggressiveSell || 1;

    return {
      symbol,
      timestamp: new Date().toISOString(),
      aggressiveBuyVolume: aggressiveBuy,
      aggressiveSellVolume: aggressiveSell,
      netPressure: aggressiveBuy - aggressiveSell,
      pressureRatio: (aggressiveBuy - aggressiveSell) / total,
      tickPressure: recent.slice(-20).map((t) => ({
        price: t.ltp,
        volume: t.volume,
        side: t.ltp >= (t.ask || t.ltp) ? 'buy' : 'sell',
        timestamp: t.timestamp,
      })),
      smartMoneyFlow: (aggressiveBuy - aggressiveSell) / total,
      confidence: Math.min(Math.abs(aggressiveBuy - aggressiveSell) / total * 2, 1),
    };
  }

  private detectSweep(symbol: string, ticks: MarketDataTick[]): SweepDetection {
    const recent = ticks.slice(-50);
    if (recent.length < 20) return { symbol, timestamp: new Date().toISOString(), sweepDetected: false, confidence: 0 };

    const highs = recent.map((t) => t.ltp);
    const maxPrice = Math.max(...highs);
    const minPrice = Math.min(...highs);
    const range = maxPrice - minPrice;

    if (range === 0) return { symbol, timestamp: new Date().toISOString(), sweepDetected: false, confidence: 0 };

    const last5 = recent.slice(-5);
    const avgLast5 = last5.reduce((s, t) => s + t.ltp, 0) / last5.length;

    const sweptHigh = highs[highs.length - 10] === maxPrice && avgLast5 < maxPrice - range * 0.1;
    const sweptLow = highs[highs.length - 10] === minPrice && avgLast5 > minPrice + range * 0.1;

    const sweepDetected = sweptHigh || sweptLow;
    const sweepType = sweepDetected ? 'liquidity_sweep' : undefined;
    const sweptLevel = sweptHigh ? maxPrice : sweptLow ? minPrice : undefined;

    return {
      symbol,
      timestamp: new Date().toISOString(),
      sweepDetected,
      sweepType,
      sweptLevel,
      sweptVolume: recent.slice(-10).reduce((s, t) => s + t.volume, 0),
      immediateReversal: sweepDetected,
      reversalStrength: sweepDetected ? Math.abs(avgLast5 - (sweptLevel || avgLast5)) / range : undefined,
      followThrough: false,
      confidence: sweepDetected ? 0.65 : 0,
    };
  }

  calculateVWAP(symbol: string, ticks: MarketDataTick[]): VWAPDeviation | null {
    if (ticks.length < 20) return null;
    const recent = ticks.slice(-100);
    let cumulativeTPV = 0;
    let cumulativeVol = 0;

    for (const t of recent) {
      const tp = (t.bid + t.ask + t.ltp) / 3 || t.ltp;
      cumulativeTPV += tp * t.volume;
      cumulativeVol += t.volume;
    }

    if (cumulativeVol === 0) return null;
    const vwap = cumulativeTPV / cumulativeVol;
    const current = recent[recent.length - 1].ltp;
    const deviation = current - vwap;
    const deviations = recent.map((t) => t.ltp - vwap);
    const mean = deviations.reduce((s, d) => s + d, 0) / deviations.length;
    const variance = deviations.reduce((s, d) => s + (d - mean) ** 2, 0) / deviations.length;
    const stdDev = Math.sqrt(variance) || 1;

    return {
      symbol,
      timestamp: new Date().toISOString(),
      vwap,
      currentPrice: current,
      deviation,
      deviationPercent: (deviation / vwap) * 100,
      standardDeviation: stdDev,
      zScore: deviation / stdDev,
      percentileRank: 0.5,
      signal: deviation > stdDev * 2 ? 'overbought' : deviation < -stdDev * 2 ? 'oversold' : 'neutral',
    };
  }

  buildVolumeProfile(symbol: string, ticks: MarketDataTick[]): VolumeProfile {
    const priceMap = new Map<number, { volume: number; bidVol: number; askVol: number }>();
    let totalVol = 0;

    for (const t of ticks) {
      const price = Math.round(t.ltp / 0.05) * 0.05;
      const entry = priceMap.get(price) || { volume: 0, bidVol: 0, askVol: 0 };
      entry.volume += t.volume;
      entry.bidVol += t.bidQty || 0;
      entry.askVol += t.askQty || 0;
      priceMap.set(price, entry);
      totalVol += t.volume;
    }

    const sorted = Array.from(priceMap.entries()).sort((a, b) => a[0] - b[0]);
    const maxVol = Math.max(...sorted.map(([, v]) => v.volume));
    const poc = sorted.find(([, v]) => v.volume === maxVol)?.[0] || 0;

    const nodes = sorted.map(([price, v]) => ({
      price,
      volume: v.volume,
      bidVolume: v.bidVol,
      askVolume: v.askVol,
      isPOC: price === poc,
      isValueArea: false,
    }));

    const valueAreaNodes = nodes.slice(Math.max(0, nodes.findIndex((n) => n.isPOC) - 3), nodes.findIndex((n) => n.isPOC) + 4);
    valueAreaNodes.forEach((n) => (n.isValueArea = true));

    const vaHigh = Math.max(...valueAreaNodes.map((n) => n.price));
    const vaLow = Math.min(...valueAreaNodes.map((n) => n.price));
    const vaVol = valueAreaNodes.reduce((s, n) => s + n.volume, 0);

    return {
      symbol,
      timestamp: new Date().toISOString(),
      valueAreaHigh: vaHigh,
      valueAreaLow: vaLow,
      pointOfControl: poc,
      valueAreaVolume: vaVol,
      totalVolume: totalVol,
      valueAreaRatio: vaVol / totalVol,
      nodes,
      lowVolumeNodes: nodes.filter((n) => n.volume < totalVol / nodes.length / 3).map((n) => ({ price: n.price, width: 0.05 })),
      highVolumeNodes: nodes.filter((n) => n.volume > maxVol * 0.7).map((n) => ({ price: n.price, width: 0.05 })),
    };
  }

  getLiquidityZones(symbol: string): LiquidityZone[] {
    return this.liquidityZones.get(symbol) || [];
  }

  getVolumeProfile(symbol: string): VolumeProfile | undefined {
    return this.volumeProfiles.get(symbol);
  }
}

export const marketMicrostructureEngine = new MarketMicrostructureEngine();