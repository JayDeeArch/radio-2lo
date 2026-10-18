import type { ServerEvent } from '@radio/shared';
import type { FastifyReply } from 'fastify';

interface Subscriber {
  id: number;
  reply: FastifyReply;
}

const subscribers = new Map<number, Subscriber>();
let nextId = 1;

const HEARTBEAT_MS = 25_000;

/** Utrzymuje połączenie SSE przy życiu (proxy często ubijają po 60 s bez ruchu). */
function startHeartbeat(subscriber: Subscriber): NodeJS.Timeout {
  return setInterval(() => {
    if (!subscribers.has(subscriber.id)) return;
    try {
      subscriber.reply.raw.write(': ping\n\n');
    } catch {
      subscribers.delete(subscriber.id);
    }
  }, HEARTBEAT_MS);
}

export function registerSubscriber(reply: FastifyReply): () => void {
  const id = nextId++;
  const subscriber: Subscriber = { id, reply };

  subscribers.set(id, subscriber);
  const heartbeat = startHeartbeat(subscriber);

  const cleanup = () => {
    clearInterval(heartbeat);
    subscribers.delete(id);
  };

  reply.raw.on('close', cleanup);
  reply.raw.on('error', cleanup);

  return cleanup;
}

export function broadcast(event: ServerEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const [id, subscriber] of subscribers) {
    try {
      subscriber.reply.raw.write(payload);
    } catch {
      subscribers.delete(id);
    }
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}
