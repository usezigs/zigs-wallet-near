// Real renderers, synthetic unfunded state. No services or user profiles.
// Set PLAYWRIGHT_MODULE to the installed playwright/index.mjs, then run this file with Node.
// Optional: CHROME_EXECUTABLE, ZIGS_DESIGN_QA_DIR, ZIGS_DESIGN_QA_CAPTURE=0.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { overviewFixture, settleOverview } from '../harness/overview-redesign-fixture.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.ZIGS_DESIGN_QA_DIR || 'solspike/.state/deslopify-qa');
mkdirSync(output, { recursive:true });
const browser = await chromium.launch({ headless:true,
  executablePath:process.env.CHROME_EXECUTABLE });
const context = await browser.newContext({ reducedMotion:'reduce' });
const page = await context.newPage();
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = (pass, label, details) => {
  checks.push({ pass:!!pass, label, ...(details ? { details } : {}) });
  if (!pass) console.error('FAIL', label, details || '');
};
async function settle() {
  await settleOverview(page);
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
    await new Promise(done => requestAnimationFrame(done));
  });
}
async function scene(tab) {
  await page.evaluate(async tab => {
    const { state, ui } = await import('/app-state.js');
    Object.assign(ui, { tab:tab === 'home' ? 'overview' : tab, create:false, receive:false,
      send:false, restore:null, menu:false });
    Object.assign(state, tab === 'home' ? { g:null, gid:null, wallet:null, groups:[] }
      : { ...globalThis.designReviewWallet });
    (await import('/app-loop.js')).draw();
  }, tab);
  await settle();
}
async function layout(label, mobile) {
  const facts = await page.evaluate(() => {
    const visible = node => {
      const style = getComputedStyle(node);
      return node.getClientRects().length && style.visibility !== 'hidden'
        && !node.closest('[hidden],[inert]');
    };
    const rect = node => {
      const r=node.getBoundingClientRect();
      return { width:r.width, height:r.height };
    };
    const controls='button.btn:not(:disabled),button.icon-btn:not(:disabled),.input';
    return { width:innerWidth, scroll:document.documentElement.scrollWidth,
      dialogs:[...document.querySelectorAll('.dialog,.drawer')].filter(visible)
        .map(node=>({ width:node.clientWidth, scroll:node.scrollWidth })),
      nav:[...document.querySelectorAll('.side-item[id^=tab-]')].filter(visible).map(rect),
      controls:[...document.querySelectorAll(controls)].filter(visible).map(rect),
      text:document.getElementById('app').innerText };
  });
  check(facts.scroll <= facts.width+1 && facts.dialogs.every(n=>n.scroll<=n.width+1),
    label+' fits viewport', facts.scroll > facts.width+1 ? facts : null);
  check(facts.nav.every(r=>r.height >= (mobile ? 48 : 36)), label+' readable navigation');
  check(facts.controls.every(r=>r.height>=47.5), label+' 48px form/action controls',
    facts.controls.filter(r=>r.height<47.5));
  return facts;
}
async function capture(name,fullPage=true) {
  if (process.env.ZIGS_DESIGN_QA_CAPTURE==='0') return;
  await settle();
  await page.screenshot({ path:resolve(output,name+'.png'), fullPage });
}
async function initialize() {
  await overviewFixture(context,page,{ messaging:true });
  await page.evaluate(async () => {
    const { state } = await import('/app-state.js');
    state.g.name='Household wallet';
    globalThis.designReviewWallet={ g:state.g, gid:state.gid,
      wallet:state.wallet, groups:state.groups };
    const chain=await import('/app-chain.js');
    chain.setChain({ gid:state.gid, birthday:4528000, cw:{ free() {} },
      bal:{ spendable:12500000, pending:0, height:4528665, tip:4528665 },
      sent:new Set(), received:[] });
    document.getElementById('engine-dot').className='dot ok';
  });
}
async function matrixCase(tab,width,theme) {
  await scene(tab);
  const label=`${tab} ${width} ${theme}`, facts=await layout(label,width<=760);
  if (tab==='overview') {
    check(facts.text.includes('0.125') && facts.text.includes('ZEC'),
      label+' retains exact native balance');
    check(facts.text.includes('Do not deposit USDC'),label+' retains deposit restrictions');
    check(facts.text.includes('approvals required'),label+' retains signing rule');
    const material=await page.evaluate(()=>{
      const balance=getComputedStyle(document.querySelector('.overview-hero'));
      const chrome=getComputedStyle(document.querySelector('.wallet-context-header'));
      return { background:balance.backgroundColor, shadow:balance.boxShadow,
        glass:chrome.backdropFilter };
    });
    const channels=material.background.match(/[\d.]+/g).slice(0,3).map(Number);
    check(channels.every(value=>theme==='light' ? value>230 : value<60),
      label+' balance panel follows theme');
    check(material.shadow!=='none',label+' subtle window elevation');
    check(material.glass.includes('blur'),label+' frosted context header');
  }
  if (tab==='swap') {
    check(facts.text.includes('Quotes only') && facts.text.includes('no funds move'),
      label+' retains quote-only disclosure');
  }
  if (tab==='home') {
    const background=await page.locator('.home-hero').evaluate(node=>
      getComputedStyle(node).backgroundColor);
    const values=background.match(/[\d.]+/g).slice(0,3).map(Number);
    check(values.every(value=>theme==='light' ? value>230 : value<60),
      label+' Home follows theme');
  }
  if ([390,1440].includes(width)) await capture(`${tab}-${width}-${theme}`);
}
async function matrix() {
  const tabs=['overview','approvals','activity','recipients','swap',
    'chats','recovery','settings','home'];
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width, height:width<768 ? 844 : 1000 });
    for (const theme of ['light','dark']) {
      await page.emulateMedia({ colorScheme:theme, reducedMotion:'reduce', forcedColors:'none' });
      await page.evaluate(theme=>{ document.documentElement.dataset.theme=theme; },theme);
      for (const tab of tabs) await matrixCase(tab,width,theme);
    }
  }
}
async function systemThemes() {
  await page.setViewportSize({ width:1440,height:1000 });
  await scene('settings');
  for (const scheme of ['light','dark']) {
    await page.emulateMedia({ colorScheme:scheme });
    const pair=await page.evaluate(scheme=>{
      document.documentElement.dataset.theme=scheme;
      const explicit=getComputedStyle(document.documentElement).getPropertyValue('--bg');
      delete document.documentElement.dataset.theme;
      return [explicit,getComputedStyle(document.documentElement).getPropertyValue('--bg')];
    },scheme);
    check(pair[0]===pair[1],scheme+' system theme matches explicit choice');
  }
}
async function mobileMenu() {
  await page.setViewportSize({ width:390,height:844 });
  await scene('overview');
  const menu=page.getByRole('button',{ name:'Menu',exact:true });
  await menu.press('Enter'); await settle();
  check(await menu.getAttribute('aria-expanded')==='true','keyboard opens mobile menu');
  await page.locator('#tab-settings').click(); await settle();
  check(await menu.getAttribute('aria-expanded')==='false','navigation closes mobile menu');
  check(await page.locator('#panel-settings').isVisible(),'mobile menu opens requested page');
  await scene('overview'); await menu.press('Tab');
  const focus=await page.evaluate(()=>{
    const style=getComputedStyle(document.activeElement);
    return { style:style.outlineStyle, width:parseFloat(style.outlineWidth) };
  });
  check(focus.style!=='none' && focus.width>=2,'keyboard focus remains visible');
}
async function dialogCase(kind,width,theme) {
  await scene(kind==='setup' ? 'home' : 'overview');
  await page.evaluate(async kind=>{
    const {ui,openCreate}=await import('/app-state.js');
    if (kind==='setup') openCreate();
    else if (kind==='receive') ui.receive=true;
    else if (kind==='restore') {
      ui.restore={ name:'Household-wallet.zigs', text:'synthetic', busy:false };
    }
    else {
      ui.send=true;
      ui.pay=[{ k:1, to:'utest1'+'q'.repeat(180), amt:'0.01234567',
        memo:'Synthetic design review' }];
    }
    (await import('/app-loop.js')).draw();
  },kind);
  await settle();
  const dialog=page.getByRole('dialog');
  check(await dialog.isVisible(),`${kind} dialog ${width} ${theme}`);
  if (kind==='send') {
    const text=await dialog.innerText();
    check(text.includes('Approvals needed') && text.includes('2 of 3'),
      `send retains approval rule ${width} ${theme}`);
  }
  await layout(`${kind} ${width} ${theme}`,width<=760);
  await capture(`${kind}-${width}-${theme}`,false);
}
async function dialogs() {
  for (const width of [320,390,1440]) {
    await page.setViewportSize({ width,height:900 });
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      for (const kind of ['setup','receive','send','restore']) await dialogCase(kind,width,theme);
    }
  }
}
async function supportDialog(kind,width,theme) {
  await scene('settings');
  if (kind==='education') await page.evaluate(async()=>
    (await import('/app-how-zigs-works.js')).openHowZigsWorks());
  else if (kind==='network') await page.locator('[data-key=network-privacy-settings]').click();
  else await page.evaluate(async()=>
    (await import('/network-privacy-popup.js')).openPrivacyPopup());
  await settle();
  check(await page.getByRole('dialog').isVisible(),`${kind} dialog ${width} ${theme}`);
  await layout(`${kind} ${width} ${theme}`,width<=760);
  await capture(`${kind}-${width}-${theme}`,false);
  if (kind==='education') {
    const captionColors=await page.evaluate(()=>{
      const probe=document.createElement('span');
      probe.style.color='var(--muted)'; document.body.append(probe);
      const expected=getComputedStyle(probe).color; probe.remove();
      const caption=document.querySelector('.hw-journey-caption');
      const label=document.querySelector('.dxa-art .dxa-label.dxa-small');
      return [expected,getComputedStyle(caption).color,getComputedStyle(label).fill];
    });
    check(captionColors.every(color=>color===captionColors[0]),
      `diagram captions follow readable theme colour ${width} ${theme}`);
    await page.locator('.home-how-content').evaluate(node=>{node.scrollTop=650;});
    await capture(`${kind}-detail-${width}-${theme}`,false);
  }
  if (kind==='privacy-demo') await page.locator('.pp-close').click();
  await page.evaluate(async()=>{
    (await import('/app-how-zigs-works.js')).closeHowZigsWorks();
    (await import('/app-network-privacy.js')).closeNetworkPrivacy();
    (await import('/app-loop.js')).draw();
  });
  await settle();
}
async function supportDialogs() {
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:1000});
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
      for (const kind of ['education','network','privacy-demo']) {
        await supportDialog(kind,width,theme);
      }
    }
  }
}
async function opaqueFallback() {
  await scene('overview');
  const session=await context.newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia',{
    features:[{name:'prefers-reduced-transparency',value:'reduce'}],
  });
  const facts=await page.locator('.wallet-context-header').evaluate(node=>({
    reduced:matchMedia('(prefers-reduced-transparency:reduce)').matches,
    filter:getComputedStyle(node).backdropFilter,
    background:getComputedStyle(node).backgroundColor,
  }));
  check(facts.reduced && facts.filter==='none','reduced transparency uses opaque chrome');
  check(!facts.background.startsWith('rgba'),'opaque fallback has no transparency');
  await session.send('Emulation.setEmulatedMedia',{features:[]});
  await session.detach();
}
async function journeyDetails() {
  await page.setViewportSize({width:390,height:844});
  await dialogCase('send',390,'light');
  const address=page.locator('[id^="s-to-"]').first();
  check(await address.getAttribute('aria-invalid')==='true','invalid address remains identified');
  const placement=await page.locator('.pay-recipient-field').first().evaluate(node=>{
    const field=node.querySelector('input').getBoundingClientRect();
    const hint=node.querySelector('[role=status]').getBoundingClientRect();
    return hint.top-field.bottom;
  });
  check(placement>=0 && placement<=16,'address validation stays beside its field');
  await page.getByRole('button',{name:'Add recipient',exact:true}).click(); await settle();
  check(await page.locator('.pay-row').count()===2,'multi-recipient editor retains both rows');
  await page.getByRole('button',{name:'Remove recipient 2',exact:true}).click(); await settle();
  check(await page.locator('.pay-row').count()===1,'recipient removal keeps the remaining row');
  await dialogCase('receive',390,'light');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,
    value:{writeText:async text=>{globalThis.designCopied=text;}}}));
  const copy=page.locator('.receive-sheet>.dialog-actions>.btn.primary');
  await copy.click();
  await page.waitForFunction(()=>document.querySelector(
    '.receive-sheet>.dialog-actions>.btn.primary')?.textContent==='Copied');
  check(await copy.textContent()==='Copied','Copy acknowledges on its own control');
  check(await copy.getAttribute('aria-live')==='polite','copy acknowledgement is announced');
  check(await page.evaluate(()=>globalThis.designCopied==='utest1'+'q'.repeat(180)),
    'Copy preserves the full destination without touching the system clipboard');
  const order=await page.locator('.receive-sheet').evaluate(node=>{
    const destination=node.querySelector('.receive-destination');
    const copy=node.querySelector('.dialog-actions');
    return !!(destination.compareDocumentPosition(copy)&Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check(order,'receiving destination precedes its copy action');
  await scene('settings');
  const disclosure=page.locator('.preference-disclosure').first();
  await disclosure.locator('summary').click(); await settle();
  const arrow=await disclosure.locator('.preference-chevron').evaluate(node=>{
    const style=getComputedStyle(node);return {rotate:style.rotate,transform:style.transform};
  });
  check(arrow.rotate==='90deg' && arrow.transform==='none',
    'expanded settings disclosure has one downward rotation');
}
async function accessibility() {
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({forcedColors:'active'});
  for (const tab of ['overview','settings','chats']) {
    await scene(tab); await layout(`${tab} forced colours`,true);
  }
  await page.emulateMedia({forcedColors:'none'});
  await page.addStyleTag({content:'html{font-size:200% !important}'});
  for (const tab of ['home','overview','settings']) {
    await scene(tab); await layout(`${tab} enlarged text`,true);
  }
}
try {
  await initialize(); await matrix(); await systemThemes();
  await mobileMenu(); await dialogs(); await supportDialogs();
  await opaqueFallback(); await journeyDetails(); await accessibility();
  check(errors.length===0,'no renderer errors',errors);
} finally {
  const failed=checks.filter(check=>!check.pass);
  const report={ checks:checks.length, passed:checks.length-failed.length, failed, errors,
    scope:'Synthetic, unfunded renderer fixtures; no live payments or physical-device checks' };
  writeFileSync(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
const failures=checks.filter(check=>!check.pass);
console.log(`deslopify browser: ${checks.length-failures.length}/${checks.length} checks pass`);
assert.equal(failures.length,0,'Design checks failed; inspect results.json');
