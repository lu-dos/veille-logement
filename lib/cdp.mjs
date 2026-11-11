// Minimal CDP client: drives the user's real Brave (cookies, session, no bot wall).
// No dependencies. Node >= 22 (global WebSocket).

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const BASE = `http://127.0.0.1:${CDP_PORT}`;

async function json(path, opts) {
  const res = await fetch(BASE + path, opts);
  return res.json();
}

class Session {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.id = 0;
    this.pending = new Map();
  }
  send(method, params = {}) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (this.sessionId) payload.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  async evaluate(expression, timeoutMs = 30000) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: timeoutMs,
    });
    if (r.exceptionDetails) {
      throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result?.value;
  }
}

function attach(ws, sessionId) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.executionContextCreated' && msg.sessionId === sessionId) {
        // context ready
      }
      if (msg.id && s && s.pending.has(msg.id)) {
        const p = s.pending.get(msg.id);
        s.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    };
    const s = new Session(ws, sessionId);
    ws.addEventListener('message', onMsg);
    s.send('Runtime.enable').then(() => resolve(s)).catch(reject);
  });
}

export async function openTab(url = 'about:blank') {
  const ver = await json('/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  // Browser-level session for Target.*
  const browser = new Session(ws, null);
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && browser.pending.has(msg.id)) {
      const p = browser.pending.get(msg.id);
      browser.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  });

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = await attach(ws, sessionId);
  await page.send('Page.enable');

  return {
    page,
    targetId,
    async goto(u, { waitMs = 3500 } = {}) {
      await page.send('Page.navigate', { url: u });
      await new Promise((r) => setTimeout(r, waitMs));
      return page.evaluate('document.readyState');
    },
    async close() {
      try { await browser.send('Target.closeTarget', { targetId }); } catch {}
      try { ws.close(); } catch {}
    },
  };
}

export async function cdpAlive() {
  try {
    await json('/json/version');
    return true;
  } catch {
    return false;
  }
}
