// Onglet Playwright : meme interface que lib/cdp.mjs (tab.goto + tab.page.evaluate),
// mais sur un Chromium local. Sert au VPS, qui n'a pas le Brave de l'utilisateur.
//
// Pourquoi : PAP accepte une IP de VPS avec un vrai navigateur (verifie : 200 et
// 39 annonces), alors qu'un simple fetch se fait bloquer. Leboncoin, lui, refuse
// meme un vrai navigateur depuis une IP datacenter (DataDome) : il reste PC-only.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function openPlaywrightTab({ headless = true } = {}) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error("playwright absent : npm i playwright && npx playwright install chromium");
  }

  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    locale: 'fr-FR',
    userAgent: UA,
    viewport: { width: 1366, height: 900 },
  });
  const page = await ctx.newPage();

  return {
    page: {
      evaluate: (expression, timeoutMs = 30000) => page.evaluate(expression).catch((e) => {
        throw new Error(String(e.message || e).slice(0, 160));
      }),
      send: async () => {
        throw new Error('CDP direct indisponible en mode Playwright');
      },
    },
    targetId: null,
    async goto(url, { waitMs = 3500 } = {}) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, waitMs));
      return page.evaluate('document.readyState');
    },
    async close() {
      try { await browser.close(); } catch {}
    },
  };
}
