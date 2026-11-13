// Read-only lab checks. No production modules, services, wallet or file operations.
import assert from 'node:assert/strict'
import {writeFileSync,mkdirSync} from 'node:fs'
import {launch} from './browser.mjs'
const browser=await launch(),checks=[],errors=[]
const page=await browser.newPage()
page.on('pageerror',e=>errors.push(e.message))
const check=(condition,label)=>{assert.ok(condition,label);checks.push(label)}
try{
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:1000})
    await page.goto('http://127.0.0.1:4196/')
    await page.getByRole('button',{name:'Pause',exact:true}).click()
    const time=await page.evaluate(()=>performance.now())
    await page.waitForTimeout(180)
    check(await page.evaluate(()=>performance.now())===time,`Pause holds the shared clock at ${width}`)
    await page.getByRole('button',{name:'Resume',exact:true}).click()
    await page.waitForTimeout(180)
    check(await page.evaluate(()=>performance.now())>time,`Resume advances the same clock at ${width}`)
    await page.getByRole('button',{name:'Poster',exact:true}).click()
    for(const theme of ['light','dark']){
      await page.getByLabel('Appearance').selectOption(theme)
      for(const story of ['payment','approvals','setup','receive','messages','recovery']){
        await page.getByLabel('Journey').selectOption(story)
        await page.waitForTimeout(100)
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${story} ${theme} ${width} fits host`)
        const clearance=await page.locator('.zs-next').evaluate(n=>{
          const stage=n.closest('.ss-stage').getBoundingClientRect(),button=n.getBoundingClientRect()
          const footer=n.closest('.zs-screen').querySelector('.zs-footer').getBoundingClientRect()
          return {button:stage.bottom-button.bottom,footer:stage.bottom-footer.bottom}
        })
        check(clearance.button>=16,`${story} ${theme} ${width} action clears the crop`)
        check(clearance.footer>=12,`${story} ${theme} ${width} full footer clears the crop`)
        const colors=await page.locator('.zs-next').evaluate(n=>({
          fg:getComputedStyle(n).color,bg:getComputedStyle(n).backgroundColor,
        }))
        const luminance=color=>{
          const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{
            const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4
          })
          return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722
        }
        const a=luminance(colors.fg),b=luminance(colors.bg)
        check((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${story} ${theme} ${width} primary contrast`)
      }
    }
    await page.getByRole('button',{name:'Replay',exact:true}).press('Enter')
    await page.waitForTimeout(100)
    check(await page.locator('.ss-stage').getAttribute('data-mark')!=='payoff',`Replay starts a new story at ${width}`)
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.waitForTimeout(150)
    check((await page.locator('#example').innerText()).includes('Matches this device'),`Reduced motion shows the recovery payoff at ${width}`)
    await page.emulateMedia({reducedMotion:'no-preference'})
  }
  await page.goto('http://127.0.0.1:4196/?scene=unknown')
  check(await page.getByLabel('Journey').inputValue()==='payment','Unknown scene falls back to payment')
  check(errors.length===0,'No viewer errors')
  console.log(`viewer: ${checks.length} checks pass`)
}finally{
  mkdirSync('shots',{recursive:true})
  writeFileSync('shots/viewer-qa.json',JSON.stringify({checks,errors},null,2)+'\n')
  await browser.close()
}
