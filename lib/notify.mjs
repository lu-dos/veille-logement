// Notification channels. Default: ntfy.sh (free, no account, phone app, no bot to create).
// Telegram optional: set provider "telegram" + botToken/chatId in config.

const UA = 'coloc-hunter/1.0';

// HTTP headers must be latin-1/ASCII: strip accents for the title only.
const ascii = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');

// ntfy Actions header: up to 3 buttons. `view` opens a URL, `http` fires a request
// (used to push "vu / postulé" to the local server from the phone).
function serializeActions(actions) {
  return actions
    .filter((a) => a && a.label && a.url)
    .slice(0, 3)
    .map((a) => {
      const parts = [a.type || 'view', a.label.replace(/[,;]/g, ' '), a.url];
      if (a.type === 'http') {
        parts.push('method=POST');
        if (a.clear !== false) parts.push('clear=true');
      }
      return parts.join(', ');
    })
    .join('; ');
}

export async function notify(cfg, title, message, url, imageUrl, actions) {
  const p = cfg.provider || 'ntfy';
  const hasImage = imageUrl && /^https?:\/\//.test(imageUrl);

  if (p === 'ntfy') {
    const topic = cfg.topic;
    if (!topic) throw new Error('ntfy: no topic configured');
    const headers = {
      'User-Agent': UA,
      Title: ascii(title).slice(0, 200),
      Priority: String(cfg.priority ?? 4),
      Tags: 'house',
      Click: cfg.clickUrl || url || '',
    };
    // ntfy fetches the image server-side and shows it inside the notification
    if (hasImage) headers.Attach = imageUrl;
    const act = actions && actions.length ? serializeActions(actions) : '';
    if (act) headers.Actions = act;
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers,
      body: message,
    });
    if (!res.ok) throw new Error('ntfy http ' + res.status);
    const j = await res.json().catch(() => ({}));
    return { ok: true, via: 'ntfy', topic, image: hasImage, actions: (j.actions || []).length };
  }

  if (p === 'telegram') {
    const caption = `${title}\n\n${message}\n\n${url || ''}`.slice(0, 1024);
    const method = hasImage ? 'sendPhoto' : 'sendMessage';
    const payload = hasImage
      ? { chat_id: cfg.chatId, photo: imageUrl, caption }
      : { chat_id: cfg.chatId, text: caption, disable_web_page_preview: false };
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!j.ok) throw new Error('telegram: ' + JSON.stringify(j.description));
    return { ok: true, via: 'telegram', image: hasImage };
  }

  throw new Error('unknown notify provider: ' + p);
}
