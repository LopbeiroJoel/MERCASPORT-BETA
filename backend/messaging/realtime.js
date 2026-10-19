const { Client } = require('pg');
const brokers = new WeakMap();

function brokerFor(pool) {
  if (brokers.has(pool)) return brokers.get(pool);
  const listeners = new Set();
  let client, connecting;
  function disconnect() {
    const old = client;
    client = null;
    if (old) old.end().catch(() => {});
  }
  async function connect() {
    if (client) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const config = { ...pool.options };
      let connectionString = process.env.MESSAGING_DATABASE_URL || config.connectionString;
      // LISTEN exige une connexion dédiée ; le pooler transactionnel Neon ne convient pas.
      if (connectionString) {
        const url = new URL(connectionString);
        if (url.hostname.endsWith('.neon.tech'))
          url.hostname = url.hostname.replace('-pooler.', '.');
        connectionString = url.toString();
      }
      const next = new Client({
        ...config,
        ...(connectionString ? { connectionString } : {}),
        application_name: 'mercasport-messages-live',
        connectionTimeoutMillis: 5000
      });
      next.on('error', () => {
        if (client === next) disconnect();
        for (const listener of [...listeners]) listener.error();
      });
      next.on('end', () => {
        if (client === next) {
          client = null;
          for (const listener of [...listeners]) listener.error();
        }
      });
      next.on('notification', (event) => {
        if (event.channel !== 'mercasport_events') return;
        try {
          const data = JSON.parse(event.payload);
          if (!Array.isArray(data.users) || data.users.length > 100) return;
          for (const listener of listeners)
            if (data.users.includes(listener.userId))
              listener.send({
                conversation_id: Number.isInteger(data.conversation_id)
                  ? data.conversation_id
                  : null
              });
        } catch {
          /* Une notification invalide n'est jamais transmise. */
        }
      });
      try {
        await next.connect();
        await next.query('LISTEN mercasport_events');
        client = next;
      } catch (error) {
        await next.end().catch(() => {});
        throw error;
      }
    })().finally(() => {
      connecting = null;
    });
    return connecting;
  }
  const broker = {
    async subscribe(userId, send, error) {
      if (listeners.size >= 64 || [...listeners].filter((l) => l.userId === userId).length >= 2)
        throw new Error('LIVE_CAPACITY');
      const listener = { userId, send, error };
      listeners.add(listener);
      try {
        await connect();
      } catch (failure) {
        listeners.delete(listener);
        throw failure;
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disconnect();
      };
    },
    close() {
      for (const listener of [...listeners]) listener.error();
      listeners.clear();
      disconnect();
    }
  };
  brokers.set(pool, broker);
  return broker;
}

function stream(pool, sessions, customBroker) {
  return async (req, res, next) => {
    let unsubscribe,
      heartbeat,
      timeout,
      closed = false;
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(timeout);
      unsubscribe?.();
      if (!res.writableEnded) res.end();
    }
    res.on('close', close);
    try {
      if (req.identity.status !== 'ACTIVE')
        return res.status(403).json({ code: 'ACTIVE_ACCOUNT_REQUIRED' });
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return res.status(403).json({ code: 'ORIGIN_DENIED' });
      const broker = customBroker || brokerFor(pool);
      unsubscribe = await broker.subscribe(
        req.identity.userId,
        (data) => {
          if (!closed) res.write(`event: refresh\ndata: ${JSON.stringify(data)}\n\n`);
        },
        close
      );
      if (closed) {
        unsubscribe();
        return;
      }
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'private, no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders();
      res.write('retry: 5000\nevent: ready\ndata: {}\n\n');
      heartbeat = setInterval(async () => {
        try {
          const identity = await sessions.authenticate(req);
          if (!identity || identity.status !== 'ACTIVE') return close();
          if (!closed) res.write(': keep-alive\n\n');
        } catch {
          close();
        }
      }, 20000);
      timeout = setTimeout(close, 55000);
      heartbeat.unref?.();
      timeout.unref?.();
    } catch {
      if (!closed && !res.headersSent)
        res.status(503).json({
          code: 'REALTIME_UNAVAILABLE',
          message: 'Le direct est indisponible. Utilisez Actualiser.'
        });
      close();
    }
  };
}
module.exports = { brokerFor, stream };
