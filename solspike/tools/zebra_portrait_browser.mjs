// Fresh, unfunded local stores. No signing, payments, or external requests.
import assert from "node:assert/strict";
import { mkdirSync,writeFileSync,renameSync } from "node:fs";
import { resolve } from "node:path";
import { entryReady } from "../harness/entry-flow.mjs";
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE
  ||"../../web/node_modules/playwright/index.mjs");
const origin=process.env.ZIGS_ZEBRA_ORIGIN||"http://127.0.0.1:8942";
assert.ok(["localhost","127.0.0.1"].includes(new URL(origin).hostname));
const output=resolve(process.env.ZIGS_ZEBRA_OUTPUT||"docs/ux-redesign/visuals/zebra-portrait");
mkdirSync(output,{recursive:true});
const report={checks:[],errors:[],facts:[]};
const check=(pass,name)=>report.checks.push({pass:!!pass,name});
const browser=await chromium.launch({headless:true,
  executablePath:process.env.CHROME_EXECUTABLE
    ||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});

async function fresh(options={}) {
  const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:"dark",
    reducedMotion:"no-preference",...options});
  const requests=[];
  await context.route("**/*",route=>{
    const url=new URL(route.request().url()); requests.push(url.pathname);
    return url.origin===origin?route.continue():route.abort();
  });
  await context.addInitScript(()=>{
    window.__portraitDraws=0;
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args) {
      const gl=get.call(this,type,...args);
      if (type==="webgl" && gl && this.classList.contains("home-hero-portrait")) {
        const draw=gl.drawElements.bind(gl);
        gl.drawElements=(...values)=>{window.__portraitDraws++;return draw(...values);};
      }
      return gl;
    };
  });
  const page=await context.newPage();
  page.on("pageerror",e=>report.errors.push(e.message));
  return {context,page,requests};
}

async function live(page) {
  await entryReady(page,origin+"/");
  // The application itself must mount the scene, without a test importing it first.
  await page.waitForSelector(".home-scene-live",{timeout:15000});
  return page.evaluate(async()=>{
    const c=(await import("/homepage-motion.js")).startHomepageMotion(document);
    return await c.current.scene.ready;
  });
}

try {
  const {context,page}=await fresh({recordVideo:{dir:resolve(output,"temporary-video"),
    size:{width:1440,height:900}}});
  const video=page.video();
  check(await live(page),"eyelid texture decoded");
  check(await page.locator(".home-hero-portrait").count()===1,"one live portrait");
  check(await page.locator(".home-motion-toggle").count()===0,"no pause button");
  await page.screenshot({path:resolve(output,"desktop.png")});
  // Actual elapsed-time performance: two natural blinks and both ear pivots occur here.
  await page.waitForTimeout(22500);
  const draws=await page.evaluate(()=>window.__portraitDraws);
  report.facts.push({liveDraws:draws,recordedSeconds:22.5});
  check(draws>100 && draws<850,"live animation is bounded below 40 draws per second");

  const pixels=await page.evaluate(async()=>{
    const {createHeroScene,sceneSample}=await import("/homepage-scene.js");
    const scene=createHeroScene(document.querySelector(".home-hero-art"));
    await scene.ready; scene.resize(512,1);
    const gl=scene.canvas.getContext("webgl");
    const read=sample=>{
      scene.draw(sample); const data=new Uint8Array(512*512*4);
      gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,data); return data;
    };
    const still=sceneSample(0),open=read(still),closed=read({...still,blink:1});
    const ear=read({...still,leftEar:.027});
    const mane=read({...still,seconds:6,gust:.7});
    const inhale=read({...still,breath:1});
    const glance=read({...still,headTurn:.045});
    const difference=(a,b,box)=>{
      let sum=0;
      for(let y=box[1];y<box[3];y++)for(let x=box[0];x<box[2];x++) {
        const i=((511-y)*512+x)*4;
        for(let c=0;c<4;c++)sum+=Math.abs(a[i+c]-b[i+c]);
      }
      return sum;
    };
    const facts={eyeChange:difference(open,closed,[170,160,250,220]),
      mouthChange:difference(open,closed,[20,270,185,410]),
      earChange:difference(open,ear,[125,0,220,145]),
      maneChange:difference(open,mane,[345,10,510,400]),
      chestChange:difference(open,inhale,[170,300,500,490]),
      anchoredBaseChange:difference(open,inhale,[0,507,512,512]),
      headTurnChange:difference(open,glance,[0,0,380,370]),
      headTurnBaseChange:difference(open,glance,[0,507,512,512]),
      indexBytes:gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER,gl.BUFFER_SIZE)};
    scene.dispose(); return facts;
  });
  report.facts.push(pixels);
  check(pixels.eyeChange>1000,"blink changes the rendered eye");
  check(pixels.mouthChange===0,"blink leaves the closed mouth unchanged");
  check(pixels.earChange>1000,"ear pivot changes the ear silhouette");
  check(pixels.maneChange>1000,"mane motion changes the mane tips");
  check(pixels.chestChange>1000,"breathing visibly expands the chest and neck");
  check(pixels.anchoredBaseChange===0,"breathing keeps the portrait base planted");
  check(pixels.headTurnChange>1000,"viewer glance changes the rendered head pose");
  check(pixels.headTurnBaseChange===0,"head turn keeps the portrait base planted");
  check(pixels.indexBytes>100000,"portrait renders a subdivided 3D surface");

  const guide=await page.getByRole("button",{name:"How Zigs works",exact:true}).boundingBox();
  await page.mouse.click(guide.x+guide.width/2,guide.y+guide.height/2);
  await page.getByRole("dialog").waitFor();
  check(await page.getByRole("dialog").isVisible(),"merged How Zigs works guide opens");
  await page.getByRole("button",{name:"Close How Zigs works",exact:true}).click();
  await page.getByRole("dialog").waitFor({state:"detached"});
  check(await page.locator(".home-hero-portrait").count()===1,
    "portrait survives closing the guide");

  // Existing glass controls have ambient transforms, so use a real pointer hit
  // instead of Playwright's requirement that their geometry stop animating.
  const join=await page.getByRole("button",{name:"Join a wallet",exact:true}).boundingBox();
  await page.mouse.click(join.x+join.width/2,join.y+join.height/2);
  await page.screenshot({path:resolve(output,"join.png")});
  await page.waitForSelector(".join");
  check(await page.locator(".home-hero-portrait").count()===1,
    "wallet entry remains interactive after redraw");
  await page.reload(); await live(page);
  await page.evaluate(async()=>{
    const c=(await import("/homepage-motion.js")).startHomepageMotion(document);
    c.stop(); c.elapsed=8600; c.draw(c.current);
  });
  await page.screenshot({path:resolve(output,"viewer-glance.png")});
  await page.evaluate(async()=>{
    const c=(await import("/homepage-motion.js")).startHomepageMotion(document);
    c.stop(); c.elapsed=4910; c.draw(c.current);
  });
  await page.screenshot({path:resolve(output,"blink.png")});
  await page.evaluate(async()=>{
    const c=(await import("/homepage-motion.js")).startHomepageMotion(document);
    c.refresh();
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before=await page.evaluate(()=>window.__portraitDraws);
  await page.waitForTimeout(250);
  check(await page.evaluate(()=>window.__portraitDraws)===before,"hidden page stops drawing");
  await page.evaluate(()=>{
    Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(150);
  check(await page.evaluate(()=>window.__portraitDraws)>before,"visible page resumes drawing");
  await page.locator(".home-hero-portrait").evaluate(c=>
    c.getContext("webgl").getExtension("WEBGL_lose_context").loseContext());
  await page.waitForSelector(".home-hero-portrait",{state:"detached"});
  check(await page.locator(".home-hero-art").evaluate(n=>getComputedStyle(n).opacity==="1"),
    "context loss restores the resting portrait");
  await context.close(); renameSync(await video.path(),resolve(output,"motion.webm"));

  for (const width of [320,390,768]) {
    const sample=await fresh({viewport:{width,height:844}});
    await live(sample.page);
    check(await sample.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),
      "no overflow at "+width+"px");
    check(await sample.page.locator(".home-motion-toggle").count()===0,
      "no motion button at "+width+"px");
    if (width===390) await sample.page.screenshot({path:resolve(output,"mobile.png")});
    await sample.context.close();
  }
  const reduced=await fresh({reducedMotion:"reduce",viewport:{width:390,height:844}});
  await entryReady(reduced.page,origin+"/");
  await reduced.page.locator(".home-hero-art").evaluate(n=>n.decode());
  check(await reduced.page.locator(".home-hero-portrait").count()===0,
    "reduced motion uses the still");
  check(!reduced.requests.some(url=>url.includes("hero-zebra-blink")),
    "reduced motion avoids the eyelid download");
  await reduced.page.screenshot({path:resolve(output,"mobile-reduced-motion.png")});
  await reduced.context.close();

  const blocked=await fresh();
  await blocked.page.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      return type==="webgl"&&this.classList.contains("home-hero-portrait")
        ?null:get.call(this,type,...args);
    };
  });
  await entryReady(blocked.page,origin+"/");
  await blocked.page.locator(".home-hero-art").evaluate(n=>n.decode());
  check(await blocked.page.locator(".home-hero-portrait").count()===0,
    "unavailable WebGL keeps the still");
  await blocked.context.close();
} finally {
  await browser.close();
  writeFileSync(resolve(output,"review.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
assert.equal(report.errors.length,0,"no page errors");
assert.ok(report.checks.every(c=>c.pass),"portrait checks pass");
