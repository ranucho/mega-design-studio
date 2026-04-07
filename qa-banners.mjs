import fs from 'fs';

// Find the latest simpsons skin (most recently modified, largest file = most compositions)
const dir = 'mega-design-studio/skins/banners/';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('gitkeep'));
const sorted = files.map(f => ({ f, mt: fs.statSync(dir + f).mtimeMs, size: fs.statSync(dir + f).size })).sort((a, b) => b.mt - a.mt);
let skinFile = null;
// Pick the most recently modified file that has > 4 compositions
for (const { f } of sorted) {
  try {
    const s = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    if ((s.compositions || []).length > 4) { skinFile = f; break; }
  } catch {}
}
if (!skinFile) skinFile = sorted[0]?.f;

console.log('Skin file:', skinFile);
const skin = JSON.parse(fs.readFileSync(dir + skinFile, 'utf8'));
const comps = skin.compositions || [];

// Reference rules
const STRIP_HIDE = ['slot', 'reel', 'tray', 'coin', 'game screenshot'];
const STRIP_SHOW = ['background', 'logo', 'character', 'cta', 'text', 'headline', 'ribbon', 'badge', 'new'];

console.log('\n' + '='.repeat(120));
console.log('  BANNER QA REPORT — ' + skin.name + ' (' + comps.length + ' compositions)');
console.log('='.repeat(120));

// === SECTION 1: SIZE OVERVIEW ===
console.log('\n\u2588\u2588 SECTION 1: SIZE OVERVIEW');
console.log('-'.repeat(90));
console.log('Preset'.padEnd(24) + 'Size'.padEnd(14) + 'Status'.padEnd(10) + 'Type'.padEnd(12) + 'Layers'.padEnd(10) + 'Visible'.padEnd(10) + 'Hidden');
console.log('-'.repeat(90));
for (const c of comps) {
  const vis = c.layers.filter(l => l.visible !== false).length;
  const hid = c.layers.filter(l => l.visible === false).length;
  const isStrip = c.height <= 100 && c.width / c.height >= 3;
  const type = isStrip ? 'STRIP' : c.height > c.width * 1.1 ? 'PORTRAIT' : Math.abs(c.width - c.height) / Math.max(c.width, c.height) < 0.15 ? 'SQUARE' : 'LANDSCAPE';
  console.log(c.presetKey.padEnd(24) + (c.width + 'x' + c.height).padEnd(14) + c.status.padEnd(10) + type.padEnd(12) + c.layers.length.toString().padEnd(10) + vis.toString().padEnd(10) + hid);
}

// === SECTION 2: PER-ELEMENT GRADING ===
console.log('\n\n\u2588\u2588 SECTION 2: PER-ELEMENT GRADING (auto-generated sizes only)');

for (const c of comps) {
  if (c.status === 'edited') continue;

  const W = c.width, H = c.height;
  const visible = c.layers.filter(l => l.visible !== false);
  const isStrip = H <= 100 && W / H >= 3;
  const isPortrait = H > W * 1.1;
  const type = isStrip ? 'STRIP' : isPortrait ? 'PORTRAIT' : Math.abs(W - H) / Math.max(W, H) < 0.15 ? 'SQUARE' : 'LANDSCAPE';

  console.log('\n' + '-'.repeat(100));
  console.log('  ' + c.presetKey + ' (' + W + 'x' + H + ') — ' + type);
  console.log('-'.repeat(100));
  console.log('  Element'.padEnd(30) + 'Role'.padEnd(14) + 'Position'.padEnd(16) + 'Size'.padEnd(16) + '%Canvas'.padEnd(14) + 'Grade'.padEnd(8) + 'Notes');
  console.log('  ' + '-'.repeat(96));

  let passCount = 0, warnCount = 0, failCount = 0;

  for (const l of c.layers) {
    const w = Math.round(l.nativeWidth * l.scaleX);
    const h = Math.round(l.nativeHeight * l.scaleY);
    const right = l.x + w;
    const bottom = l.y + h;
    const pW = Math.round(w / W * 100);
    const pH = Math.round(h / H * 100);
    const ll = l.name.toLowerCase();
    const notes = [];
    let grade = 'PASS';

    if (l.visible === false) {
      // Check if it SHOULD be hidden
      if (isStrip) {
        const shouldHide = STRIP_HIDE.some(k => ll.includes(k));
        const isVariant = l.name.includes('(') || ll.includes('2-line') || ll.includes('short');
        if (shouldHide || isVariant) { grade = 'PASS'; notes.push('correctly hidden'); }
        else { grade = 'WARN'; notes.push('hidden — verify intended'); }
      } else {
        const isVariant = l.name.includes('(') || ll.includes('2-line') || ll.includes('short');
        if (isVariant) { grade = 'PASS'; notes.push('variant hidden'); }
        else { grade = 'FAIL'; notes.push('VISIBLE ELEMENT HIDDEN'); failCount++; continue; }
      }
      console.log('  ' + l.name.padEnd(28) + l.role.padEnd(14) + '(hidden)'.padEnd(16) + '-'.padEnd(16) + '-'.padEnd(14) + grade.padEnd(8) + notes.join(', '));
      if (grade === 'PASS') passCount++; else if (grade === 'WARN') warnCount++;
      continue;
    }

    // === BACKGROUND ===
    if (l.role === 'background') {
      if (w >= W * 0.99 && h >= H * 0.99) { grade = 'PASS'; notes.push('fills canvas'); }
      else { grade = 'FAIL'; notes.push('GAP — does not fill canvas'); }
    }
    // === CTA ===
    else if (l.role === 'cta' || ll.includes('cta')) {
      const mB = Math.round((H - bottom) / H * 100);
      const mR = Math.round((W - right) / W * 100);
      const mL = Math.round(l.x / W * 100);
      const mT = Math.round(l.y / H * 100);
      if (isStrip) {
        if (right >= W * 0.85) notes.push('right-aligned');
        else { grade = 'FAIL'; notes.push('NOT right-aligned (' + mR + '% from right)'); }
        if (ll.includes('short')) notes.push('short text');
        else { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('full text (should be short)'); }
      } else {
        if (mB < 3) { grade = 'FAIL'; notes.push('BOTTOM MARGIN ' + mB + '% (need 5%+)'); }
        else notes.push('bottom margin ' + mB + '%');
        if (mL < 2 || mR < 2) { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('edge margin tight'); }
        if (pW > 70) { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('very wide ' + pW + '%'); }
      }
    }
    // === CHARACTER ===
    else if (l.role === 'character') {
      const cropR = right > W ? Math.round((right - W) / w * 100) : 0;
      const cropB = bottom > H ? Math.round((bottom - H) / h * 100) : 0;
      const cropL = l.x < 0 ? Math.round(-l.x / w * 100) : 0;
      const cropT = l.y < 0 ? Math.round(-l.y / h * 100) : 0;
      const maxCrop = Math.max(cropR, cropB, cropL, cropT);

      if (isStrip) {
        if (pH >= 50) notes.push('good height');
        else { grade = 'FAIL'; notes.push('too small ' + pH + '%h (need 50%+)'); }
      } else {
        if (maxCrop > 20) { grade = 'FAIL'; notes.push('CROPPED ' + maxCrop + '%'); }
        else if (maxCrop > 10) { grade = 'WARN'; notes.push('slightly cropped ' + maxCrop + '%'); }
        if (pH > 85) { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('too large ' + pH + '%h'); }
        if (pH < 15) { grade = 'FAIL'; notes.push('too small ' + pH + '%h'); }
        // Check slot overlap
        const slot = visible.find(sl => sl.name.toLowerCase().includes('slot') || sl.name.toLowerCase().includes('reel'));
        if (slot) {
          const slotW = slot.nativeWidth * slot.scaleX;
          const slotRight = slot.x + slotW;
          const overlap = Math.max(0, Math.min(right, slotRight) - Math.max(l.x, slot.x));
          if (overlap > slotW * 0.25) { grade = 'FAIL'; notes.push('COVERS SLOT ' + Math.round(overlap / slotW * 100) + '%'); }
          else if (overlap > slotW * 0.10) { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('slight slot overlap'); }
          else notes.push('clear of slot');
        }
      }
    }
    // === LOGO ===
    else if (l.role === 'logo') {
      if (isStrip) {
        if (l.x < W * 0.25) notes.push('left-positioned');
        else { grade = 'WARN'; notes.push('not left-aligned'); }
      } else {
        if (pW > 25) { grade = 'FAIL'; notes.push('TOO LARGE ' + pW + '%w (max 15-20%)'); }
        else if (pW > 18) { grade = 'WARN'; notes.push('slightly large ' + pW + '%w'); }
        else notes.push('good size');
      }
    }
    // === RIBBON/BADGE ===
    else if (ll.includes('badge') || (ll.includes('new') && l.role === 'decoration')) {
      if (l.x < W * 0.03 && l.y < H * 0.03) notes.push('flush corner');
      else if (l.x < W * 0.08 && l.y < H * 0.08) { grade = 'WARN'; notes.push('near corner (' + Math.round(l.x) + ',' + Math.round(l.y) + ')'); }
      else { grade = 'FAIL'; notes.push('NOT in corner (' + Math.round(l.x) + ',' + Math.round(l.y) + ')'); }
    }
    // === COINS ===
    else if (ll.includes('coin')) {
      if (isStrip) { grade = 'FAIL'; notes.push('VISIBLE on strip (should be hidden)'); }
      else {
        const coinTopPct = Math.round(l.y / H * 100);
        if (coinTopPct >= 70) notes.push('bottom ' + coinTopPct + '%');
        else if (coinTopPct >= 50) { grade = 'WARN'; notes.push('mid-low ' + coinTopPct + '% (should be bottom)'); }
        else { grade = 'FAIL'; notes.push('FLOATING at ' + coinTopPct + '% (should be >70%)'); }
      }
    }
    // === SPEECH BUBBLE ===
    else if (ll.includes('speech') || ll.includes('bubble')) {
      if (isStrip && W !== 728) { grade = 'FAIL'; notes.push('visible on small strip'); }
      // Check face overlap
      const char = visible.find(vl => vl.role === 'character');
      if (char) {
        const charH = char.nativeHeight * char.scaleY;
        const faceBottom = char.y + charH * 0.35;
        const bBottom = l.y + h;
        const hOvl = Math.min(right, char.x + char.nativeWidth * char.scaleX + 10) - Math.max(l.x, char.x - 10);
        const vOvl = Math.min(bBottom, faceBottom + 10) - Math.max(l.y, char.y - 10);
        if (hOvl > 0 && vOvl > 0) { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('overlaps face zone'); }
        else notes.push('clear of face');
      }
    }
    // === SLOT/REEL ===
    else if (ll.includes('slot') || ll.includes('reel') || ll.includes('tray')) {
      if (isStrip) { grade = 'FAIL'; notes.push('VISIBLE on strip'); }
      else {
        if (right > W * 1.05 || bottom > H * 1.05) { grade = 'FAIL'; notes.push('OVERFLOWS canvas'); }
        if (pW > 65) { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('very large ' + pW + '%w'); }
      }
    }
    // === TEXT/HEADLINE ===
    else if (l.role === 'text' || ll.includes('headline')) {
      if (pW < 5) { grade = 'WARN'; notes.push('very small'); }
      // Check ribbon overlap
      const ribbon = visible.find(rl => rl.name.toLowerCase().includes('badge') || rl.name.toLowerCase().includes('new'));
      if (ribbon) {
        const ribbonRight = ribbon.x + ribbon.nativeWidth * ribbon.scaleX;
        const ribbonBottom = ribbon.y + ribbon.nativeHeight * ribbon.scaleY;
        if (l.x < ribbonRight && l.y < ribbonBottom) { grade = grade === 'FAIL' ? 'FAIL' : 'WARN'; notes.push('may overlap ribbon'); }
      }
    }
    // === OTHER ===
    else {
      if (l.x + w < 0 || l.y + h < 0 || l.x > W || l.y > H) { grade = 'FAIL'; notes.push('OFF CANVAS'); }
    }

    if (notes.length === 0) notes.push('ok');

    console.log('  ' + l.name.padEnd(28) + l.role.padEnd(14) + (Math.round(l.x) + ',' + Math.round(l.y)).padEnd(16) + (w + 'x' + h).padEnd(16) + (pW + '%w ' + pH + '%h').padEnd(14) + grade.padEnd(8) + notes.join(', '));
    if (grade === 'PASS') passCount++; else if (grade === 'WARN') warnCount++; else failCount++;
  }

  const total = passCount + warnCount + failCount;
  const score = Math.round((passCount + warnCount * 0.5) / total * 100);
  const verdict = failCount === 0 ? 'PASS' : failCount <= 2 ? 'WARN' : 'FAIL';
  console.log('  ' + '-'.repeat(96));
  console.log('  VERDICT: ' + verdict + ' | Score: ' + score + '% | PASS:' + passCount + ' WARN:' + warnCount + ' FAIL:' + failCount);
}

// === SECTION 3: OVERLAP MATRIX ===
console.log('\n\n\u2588\u2588 SECTION 3: CRITICAL OVERLAPS');
console.log('-'.repeat(80));
console.log('Size'.padEnd(24) + 'Char-Slot'.padEnd(18) + 'Bubble-Face'.padEnd(18) + 'Text-Ribbon'.padEnd(18));
console.log('-'.repeat(80));

for (const c of comps) {
  if (c.status === 'edited') continue;
  const vis = c.layers.filter(l => l.visible !== false);
  const char = vis.find(l => l.role === 'character');
  const slot = vis.find(l => l.name.toLowerCase().includes('slot') || l.name.toLowerCase().includes('reel'));
  const bubble = vis.find(l => l.name.toLowerCase().includes('speech') || l.name.toLowerCase().includes('bubble'));
  const text = vis.find(l => l.role === 'text');
  const ribbon = vis.find(l => l.name.toLowerCase().includes('badge') || (l.name.toLowerCase().includes('new') && l.role === 'decoration'));

  let charSlot = '-';
  if (char && slot) {
    const overlap = Math.max(0, Math.min(char.x + char.nativeWidth * char.scaleX, slot.x + slot.nativeWidth * slot.scaleX) - Math.max(char.x, slot.x));
    const slotW = slot.nativeWidth * slot.scaleX;
    const pct = Math.round(overlap / slotW * 100);
    charSlot = pct > 25 ? 'FAIL ' + pct + '%' : pct > 10 ? 'WARN ' + pct + '%' : 'OK ' + pct + '%';
  }

  let bubbleFace = '-';
  if (bubble && char) {
    const faceBottom = char.y + char.nativeHeight * char.scaleY * 0.35;
    const hO = Math.min(bubble.x + bubble.nativeWidth * bubble.scaleX, char.x + char.nativeWidth * char.scaleX + 10) - Math.max(bubble.x, char.x - 10);
    const vO = Math.min(bubble.y + bubble.nativeHeight * bubble.scaleY, faceBottom + 10) - Math.max(bubble.y, char.y - 10);
    bubbleFace = (hO > 0 && vO > 0) ? 'FAIL overlap' : 'OK clear';
  }

  let textRibbon = '-';
  if (text && ribbon) {
    const rr = ribbon.x + ribbon.nativeWidth * ribbon.scaleX;
    const rb = ribbon.y + ribbon.nativeHeight * ribbon.scaleY;
    textRibbon = (text.x < rr && text.y < rb) ? 'WARN overlap' : 'OK';
  }

  console.log(c.presetKey.padEnd(24) + charSlot.padEnd(18) + bubbleFace.padEnd(18) + textRibbon.padEnd(18));
}

// === SECTION 4: SUMMARY ===
console.log('\n\n\u2588\u2588 SECTION 4: SUMMARY');
console.log('-'.repeat(60));
const autoComps = comps.filter(c => c.status !== 'edited');
let totalPass = 0, totalWarn = 0, totalFail = 0;
for (const c of autoComps) {
  const vis = c.layers.filter(l => l.visible !== false);
  const isStrip = c.height <= 100 && c.width / c.height >= 3;
  let fails = 0;

  // Quick checks
  const cta = vis.find(l => l.role === 'cta');
  if (cta && !isStrip) {
    const mB = (c.height - cta.y - cta.nativeHeight * cta.scaleY) / c.height * 100;
    if (mB < 3) fails++;
  }
  const char = vis.find(l => l.role === 'character');
  const slot = vis.find(l => l.name.toLowerCase().includes('slot') || l.name.toLowerCase().includes('reel'));
  if (char && slot) {
    const o = Math.max(0, Math.min(char.x + char.nativeWidth * char.scaleX, slot.x + slot.nativeWidth * slot.scaleX) - Math.max(char.x, slot.x));
    if (o > slot.nativeWidth * slot.scaleX * 0.25) fails++;
  }
  const logo = vis.find(l => l.role === 'logo');
  if (logo && !isStrip && logo.nativeWidth * logo.scaleX > c.width * 0.25) fails++;
  if (isStrip && !logo) fails++;
  const coins = vis.find(l => l.name.toLowerCase().includes('coin'));
  if (coins && !isStrip && coins.y < c.height * 0.5) fails++;

  if (fails === 0) totalPass++;
  else if (fails <= 1) totalWarn++;
  else totalFail++;
}
console.log('PASS: ' + totalPass + ' | WARN: ' + totalWarn + ' | FAIL: ' + totalFail + ' / ' + autoComps.length + ' auto-generated');
console.log('');
