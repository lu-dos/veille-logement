// Onglet Playwright : meme interface que lib/cdp.mjs (tab.goto + tab.page.evaluate),
// mais sur un Chromium local. Sert au VPS, qui n'a pas le Brave de l'utilisateur.
//
// Pourquoi : PAP accepte une IP de VPS avec un vrai navigateur (verifie : 200),
// alors qu'un simple fetch se fait bloquer. Leboncoin, lui, refuse meme un vrai
// navigateur depuis une IP datacenter (DataDome) : il reste PC-only.
//
// Limite constatee : Cloudflare n'accorde qu'UNE requete par contexte de navigation.
// La deuxieme requete du meme contexte part en 403 "Just a moment...". D'ou
// freshExtract : un contexte neuf par requete, puis on jette le contexte.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const LANCEMENT = {
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
};

const OPTIONS = { locale: 'fr-FR', userAgent: UA, viewport: { width: 1366, height: 900 } };

function chargerPlaywright() {
  try {
    return require('playwright');
  } catch {
    throw new Error('playwright absent : npm i playwright && npx playwright install chromium');
  }
}

export async function openPlaywrightTab({ headless = true } = {}) {
  const { chromium } = chargerPlaywright();
  const browser = await chromium.launch({ ...LANCEMENT, headless });
  const ctx = await browser.newContext(OPTIONS);
  const page = await ctx.newPage();

  return {
    page: {
      evaluate: (expression, timeoutMs = 30000) =>
        page.evaluate(expression).catch((e) => {
          throw new Error(String(e.message || e).slice(0, 160));
        }),
      send: async () => {
        throw new Error('CDP direct indisponible en mode Playwright');
      },
    },
    targetId: null,
    // Une requete = un contexte neuf. Renvoie la valeur JSON de `expression`,
    // evaluee dans la page chargee, puis ferme le contexte.
    async freshExtract(url, expression, { waitMs = 2500, timeout = 45000 } = {}) {
      const c = await browser.newContext(OPTIONS);
      const p = await c.newPage();
      try {
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await new Promise((r) => setTimeout(r, waitMs));
        return await p.evaluate(expression);
      } finally {
        await c.close().catch(() => {});
      }
    },
    async goto(url, { waitMs = 3500 } = {}) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((r) => setTimeout(r, waitMs));
      return page.evaluate('document.readyState');
    },
    async close() {
      try {
        await browser.close();
      } catch {}
    },
  };
}
