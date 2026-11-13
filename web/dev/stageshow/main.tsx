import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import PaymentScene,{stories,type Story} from './scenes/PaymentScene'
import GoldHero from './gold/hero-demo'
import GoldPair from './gold/device-pair'
import GoldForm from './gold/form-error'
import '../../design-system.css'
import './kit/stageshow.css'
import './viewer.css'
import {installVirtualClock} from './kit/clock'
const query=new URLSearchParams(location.search)
// Tool-only capture mode. The kit clock samples every logical frame even when
// PNG encoding stalls Chrome. Ordinary viewing retains the browser's native clock.
const playback={paused:false}
if(query.get('clock')==='film'||(!query.has('capture')&&!query.has('gold'))){
  const frame=window.requestAnimationFrame.bind(window),clock=installVirtualClock()
  let last=0
  document.addEventListener('visibilitychange',()=>{last=0})
  const pump=async(now:number)=>{
    const delta=last?Math.min(100,now-last):0;last=now
    if(!playback.paused){
      if(query.get('clock')==='film')await clock.step()
      else if(delta)await clock.advance(delta)
    }
    frame(pump)
  }
  frame(pump)
}
function App(){
  const [story,setStory]=useState<Story>(Object.hasOwn(stories,query.get('scene')||'')?query.get('scene') as Story:'payment')
  const [theme,setTheme]=useState<'light'|'dark'>(query.get('theme')==='dark'?'dark':'light')
  const [run,setRun]=useState(0),[still,setStill]=useState(query.has('still'))
  const [paused,setPaused]=useState(false)
  document.documentElement.dataset.theme=theme
  const gold=query.get('gold'),direct=query.has('capture')||!!gold
  const scene=gold==='device-pair'?<GoldPair/>:gold==='form-error'?<GoldForm/>:gold?<GoldHero/>:
    <PaymentScene key={story+theme+run+still} story={story} theme={theme} still={still} opening={query.has('opening')}/>
  return <main className={direct?'capture':'lab'}>
    {!direct&&<><header className="lab-header"><div><p className="lab-eyebrow">Zigs · Design rehearsal</p>
      <h1>Every detail, together.</h1><p>Six journeys. One visual language.</p></div>
      <a href="https://app.zigs.app">Open the app</a></header>
      <div className="lab-controls">
        <label>Journey<select value={story} onChange={e=>setStory(e.target.value as Story)}>
          {Object.entries(stories).map(([id,[title]])=><option key={id} value={id}>{title}</option>)}</select></label>
        <label>Appearance<select value={theme} onChange={e=>setTheme(e.target.value as 'light'|'dark')}>
          <option value="light">Light</option><option value="dark">Dark</option></select></label>
        <button type="button" onClick={()=>{setStill(false);setRun(n=>n+1);setPaused(false);playback.paused=false}}>Replay</button>
        <button type="button" onClick={()=>{playback.paused=!paused;setPaused(!paused)}}>{paused?"Resume":"Pause"}</button>
        <button type="button" aria-pressed={still} onClick={()=>setStill(s=>!s)}>Poster</button>
      </div><p className="lab-description" aria-live="polite">{stories[story][1]}</p></>}
    <div id="example" aria-hidden="true">{scene}</div>
    {!direct&&<p className="lab-disclosure">Authored illustration with sample data. No wallet, account, clipboard, file or network actions are performed.</p>}
  </main>
}
createRoot(document.getElementById('root')!).render(<App/> )
