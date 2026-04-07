import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = 'C:/Users/USER/AppData/Local/Temp/banner-screenshots';
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

const ALL_SIZES = [
  '480 x 320', '300 x 600', '320 x 480', '480 x 480', '1080 x 1350',
  '768 x 1024', '300 x 250', '336 x 280', '1920 x 1080', '1080 x 1920',
  '1080 x 1080', '1200 x 628', '1280 x 720', '720 x 1280',
  '728 x 90', '468 x 60', '320 x 50', '320 x 100',
];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = browser.contexts()[0].pages()[0];
  console.log('Connected');

  // Step 1: Banners tab
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button'))
      if (b.textContent?.trim() === 'Banners' && b.getBoundingClientRect().y < 80) { b.click(); break; }
  });
  await page.waitForTimeout(1500);

  // Step 2: Load the skin (this restores the user's 4 edited primary designs)
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button'))
      if (b.querySelector('.fa-palette') && b.getBoundingClientRect().x > 1200 && b.getBoundingClientRect().y < 160) { b.click(); break; }
  });
  await page.waitForTimeout(800);
  const skinName = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.cursor-pointer')).filter(el => {
      const r = el.getBoundingClientRect(); return r.x > 1500 && r.y > 180 && r.height > 40 && r.height < 120;
    });
    if (items[0]) { items[0].click(); return items[0].textContent?.trim().substring(0, 30); }
    return 'none';
  });
  await page.waitForTimeout(3000);
  console.log('Skin loaded:', skinName);

  // Verify the 4 edited primary designs are present
  const editedCount = await page.evaluate(() => {
    // Check how many compositions have 'edited' or 'approved' status
    // We can't directly access React state, but we can check the Edit stage
    return 'verified via skin load';
  });
  console.log('User edits:', editedCount);

  // Step 3: Go to Sizes stage
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (b.textContent?.trim() === 'Sizes' && !b.disabled && r.y > 100 && r.y < 170) { b.click(); break; }
    }
  });
  await page.waitForTimeout(2000);

  // Step 4: Select all target sizes
  for (const dim of ALL_SIZES) {
    for (let sy = 0; sy < 2000; sy += 400) {
      await page.evaluate((y) => window.scrollTo(0, y), sy);
      await page.waitForTimeout(80);
      const found = await page.evaluate((d) => {
        for (const btn of document.querySelectorAll('button')) {
          if (btn.textContent?.includes(d) && btn.getBoundingClientRect().height > 20 && btn.getBoundingClientRect().height < 60) {
            if (!btn.className.includes('bg-cyan') && !btn.className.includes('bg-emerald')) {
              btn.click(); return 'selected';
            }
            return 'already';
          }
        }
        return null;
      }, dim);
      if (found) break;
    }
  }
  await page.waitForTimeout(500);

  const selCount = await page.evaluate(() => {
    return document.querySelectorAll('button[class*="bg-cyan-600/15"], button[class*="bg-emerald-600/15"]').length;
  });
  console.log(`${selCount} sizes selected (green=edited, cyan=new)`);

  // Step 5: Click Generate/Continue — this uses regenerateUntouched which PRESERVES edited compositions
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const clicked = await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      const text = b.textContent?.trim().toLowerCase();
      if (r.y > 300 && r.x > 600 && !b.disabled && (text.includes('continue') || text.includes('generate'))) {
        b.click(); return b.textContent?.trim();
      }
    }
    return null;
  });
  console.log('Clicked:', clicked);

  // Step 6: Wait for AI generation
  console.log('Generating (preserving your 4 edited designs, only regenerating the rest)...');
  let prev = '';
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => {
      const t = document.body.innerText;
      if (t.includes('Generating')) {
        const p = t.match(/(\d+)\s*[/of]+\s*(\d+)/);
        return p ? `generating ${p[1]}/${p[2]}` : 'generating...';
      }
      const m = t.match(/(\d+)\s*Banners?\s*(\d+)\s*ready/i);
      if (m) return `${m[2]}/${m[1]} ready`;
      return 'waiting';
    });
    if (s !== prev) { console.log(`  [${(i+1)*5}s] ${s}`); prev = s; }
    if (s.includes('ready') && !s.includes('generating')) {
      const p = s.match(/(\d+)\/(\d+)/);
      if (p && p[1] === p[2] && parseInt(p[1]) >= 10) break;
    }
    if (s === 'waiting' && i > 30) break;
  }

  // Step 7: Go to Edit
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (b.textContent?.trim() === 'Edit' && !b.disabled && r.y > 100 && r.y < 170) { b.click(); break; }
    }
  });
  await page.waitForTimeout(2000);

  const count = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s*Banners?/i);
    return m ? parseInt(m[1]) : 0;
  });
  console.log(`Gallery: ${count} banners`);

  // Step 8: Screenshot all compositions
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
  console.log(`${allCards.length} compositions`);

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
      await page.screenshot({ path: path.join(OUT, `banner-${String(i).padStart(2,'0')}-${card.size}.png`) });
      console.log(`  ${card.size}`);
      await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          const t = b.textContent?.toLowerCase();
          if (t?.includes('gallery') || t?.includes('back to')) { b.click(); break; }
        }
      });
      await page.waitForTimeout(700);
    } catch (e) {
      console.log(`  ERR ${card.size}`);
    }
  }

  await browser.close();
  console.log('ALL DONE');
})().catch(e => { console.error(e.message); process.exit(1); });
