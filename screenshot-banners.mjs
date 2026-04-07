import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = 'C:/Users/USER/AppData/Local/Temp/banner-screenshots';
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  console.log('Connected:', page.url());

  // Go to Banners tab
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button'))
      if (b.textContent?.trim() === 'Banners' && b.getBoundingClientRect().y < 80) { b.click(); break; }
  });
  await page.waitForTimeout(1500);

  // Load first skin
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button'))
      if (b.querySelector('.fa-palette') && b.getBoundingClientRect().x > 1200 && b.getBoundingClientRect().y < 160) { b.click(); break; }
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.cursor-pointer')).filter(el => {
      const r = el.getBoundingClientRect(); return r.x > 1500 && r.y > 180 && r.height > 40 && r.height < 120;
    });
    if (items[0]) items[0].click();
  });
  await page.waitForTimeout(3000);

  // Click Edit
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (b.textContent?.trim() === 'Edit' && !b.disabled && r.y > 100 && r.y < 170 && r.height < 40) { b.click(); break; }
    }
  });
  await page.waitForTimeout(2000);

  const count = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*Banners?/i);
    return m ? parseInt(m[1]) : 0;
  });
  console.log(`${count} banners`);

  // Collect all canvases
  let allCards = [];
  for (let sy = 0; sy < 5000; sy += 400) {
    await page.evaluate((y) => window.scrollTo(0, y), sy);
    await page.waitForTimeout(150);
    const found = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('canvas')).map(c => {
        const r = c.getBoundingClientRect();
        if (r.width < 30 || r.height < 30) return null;
        let el = c.parentElement;
        let size = '';
        for (let i = 0; i < 6 && el; i++) {
          const m = el.textContent?.match(/(\d{3,4})[x×](\d{3,4})/);
          if (m) { size = m[1] + 'x' + m[2]; break; }
          el = el.parentElement;
        }
        return { size, absX: Math.round(r.x + r.width/2), absY: Math.round(r.y + window.scrollY + r.height/2) };
      }).filter(Boolean);
    });
    for (const f of found) {
      if (!allCards.some(c => Math.abs(c.absX - f.absX) < 30 && Math.abs(c.absY - f.absY) < 30)) allCards.push(f);
    }
  }
  console.log(`${allCards.length} compositions: ${allCards.map(c => c.size).join(', ')}`);

  // Screenshot each
  for (let i = 0; i < allCards.length; i++) {
    const card = allCards[i];
    try {
      await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 300)), card.absY);
      await page.waitForTimeout(200);
      const vp = await page.evaluate(({ ay, ax }) => {
        for (const c of document.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect();
          if (Math.abs(r.y + window.scrollY + r.height/2 - ay) < 30 && Math.abs(r.x + r.width/2 - ax) < 30)
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }
        return null;
      }, { ay: card.absY, ax: card.absX });
      if (!vp) continue;

      await page.mouse.click(vp.x, vp.y);
      await page.waitForTimeout(1500);
      const fname = `banner-${String(i).padStart(2,'0')}-${card.size}.png`;
      await page.screenshot({ path: path.join(OUT, fname) });
      console.log(`  ${fname}`);

      await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          const t = b.textContent?.toLowerCase();
          if (t?.includes('gallery') || t?.includes('back to')) { b.click(); break; }
        }
      });
      await page.waitForTimeout(700);
    } catch (e) {
      console.log(`  ERR ${card.size}: ${e.message.substring(0,50)}`);
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await browser.close();
  console.log('DONE');
})().catch(e => { console.error(e.message); process.exit(1); });
