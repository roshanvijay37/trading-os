import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  EventType,
  EventEnvelope,
  EventMetadata,
  IEventBus,
  EventHandler,
} from '@domain/events/TradingEvents';

export class EventBus implements IEventBus {
  private emitter = new EventEmitter();
  private eventLog: EventEnvelope[] = [];
  private readonly maxLogSize = 100000;
  private subscribers = new Map<string, number>();

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    this.eventLog.push(event as EventEnvelope);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize / 2);
    }

    const key = event.type;
    this.emitter.emit(key, event);
    this.emitter.emit('*', event);
  }

  subscribe<T>(type: EventType, handler: EventHandler<T>): () => void {
    const wrappedHandler = (event: EventEnvelope<T>) => {
      Promise.resolve(handler(event)).catch((err) => {
        console.error(`Event handler error for ${type}:`, err);
      });
    };

    this.emitter.on(type, wrappedHandler);
    this.subscribers.set(type, (this.subscribers.get(type) || 0) + 1);

    return () => {
      this.emitter.off(type, wrappedHandler);
      const count = (this.subscribers.get(type) || 1) - 1;
      if (count <= 0) this.subscribers.delete(type);
      else this.subscribers.set(type, count);
    };
  }

  subscribePattern<T>(pattern: RegExp, handler: EventHandler<T>): () => void {
    const wrappedHandler = (event: EventEnvelope<T>) => {
      if (pattern.test(event.type)) {
        Promise.resolve(handler(event)).catch((err) => {
          console.error(`Pattern handler error for ${pattern}:`, err);
        });
      }
    };

    this.emitter.on('*', wrappedHandler);
    return () => this.emitter.off('*', wrappedHandler);
  }

  async *getEventStream(): AsyncGenerator<EventEnvelope> {
    for (const event of this.eventLog) {
      yield event;
    }
  }

  createEvent<T>(type: EventType, payload: T, source: string, partitionKey: string): EventEnvelope<T> {
    const metadata: EventMetadata = {
      eventId: uuidv4(),
      timestamp: new Date().toISOString(),
      correlationId: uuidv4(),
      source,
      version: 1,
      partitionKey,
    };

    return { type, payload, metadata };
  }

  getRecentEvents(count: number = 1000): EventEnvelope[] {
    return this.eventLog.slice(-count);
  }

  getEventsByType(type: EventType): EventEnvelope[] {
    return this.eventLog.filter((e) => e.type === type);
  }

  getSubscriberCounts(): Map<string, number> {
    return new Map(this.subscribers);
  }
}

export const globalEventBus = new EventBus();