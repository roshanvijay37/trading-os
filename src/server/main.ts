import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerRoutes } from './routes';
import { startEngines } from './engineManager';

const server = Fastify({ logger: true });

async function main() {
  await server.register(cors, { origin: true, credentials: true });
  await server.register(websocket);

  await registerRoutes(server);
  await startEngines();

  const port = parseInt(process.env.PORT || '3001');
  await server.listen({ port, host: '0.0.0.0' });

  console.log(`[TradingOS Server] Running on port ${port}`);
}

main().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});