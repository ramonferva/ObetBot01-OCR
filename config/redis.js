const redis = require('redis');
require('dotenv').config();

const REDIS_HOST     = process.env.REDIS_HOST     || '127.0.0.1';
const REDIS_PORT     = process.env.REDIS_PORT     || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || null;

let client = null;
let connecting = false;

const redisClient = async () => {
  // Si ya está listo, retornar directo
  if (client && client.isReady) return client;

  // Evitar múltiples conexiones simultáneas
  if (connecting) {
    // Esperar hasta que conecte (máx 5 segundos)
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (client && client.isReady) return client;
    }
    throw new Error('Redis: timeout esperando conexión');
  }

  connecting = true;

  try {
    // Si existe un cliente en mal estado, destruirlo
    if (client) {
      try { await client.quit(); } catch (_) {}
      client = null;
    }

    client = redis.createClient({
      socket: {
        host: REDIS_HOST,
        port: parseInt(REDIS_PORT),
        reconnectStrategy: (retries) => {
          if (retries > 10) return new Error('Redis: sin conexión');
          return Math.min(retries * 300, 2000);
        }
      },
      ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    });

    client.on('error',        err => console.error('Redis error', err));
    client.on('connect',      ()  => console.log('Redis conectado'));
    client.on('reconnecting', ()  => console.log('Redis reconectando...'));
    client.on('end',          ()  => { console.log('Redis desconectado'); client = null; });

    await client.connect();
    return client;

  } finally {
    connecting = false;
  }
};

module.exports = redisClient;