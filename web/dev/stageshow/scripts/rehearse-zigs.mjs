// Run with the local Vite server. Each job records its own gate report and contact sheet.
import {spawn} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
const mode=process.argv[2]||'still'
if(!['still','loop','states','opening'].includes(mode))throw Error('Use still, loop, states or opening')
const allScenes=['payment','approvals','setup','receive','messages','recovery']
const scenes=process.argv[3]?process.argv[3].split(','):allScenes
if(scenes.some(s=>!allScenes.includes(s)))throw Error('Unknown scene')
const jobs=scenes.flatMap(scene=>['light','dark'].flatMap(theme=>[1280,390].map(width=>({scene,theme,width}))))
mkdirSync('shots',{recursive:true})
const results=[]
async function worker(){while(jobs.length){
  const j=jobs.shift(),name=`${j.scene}-${j.theme}-${j.width}-${mode}`
  const url=`http://127.0.0.1:4196/?capture&clock=film&scene=${j.scene}&theme=${j.theme}${mode==='still'?'&still':''}${mode==='opening'?'&opening':''}`
  const args=['scripts/film.mjs',url,'--width',String(j.width),'--gate','--out',`shots/${name}.png`,'--report',`shots/${name}.json`]
  if(mode==='still'||mode==='opening')args.push('--still')
  else if(mode==='states')args.push('--states','--states-for','16000')
  else args.push('--every','1000','--count','16')
  const r=await new Promise(resolve=>{
    const p=spawn(process.execPath,args,{env:process.env});let log=''
    p.stdout.on('data',d=>{log+=d});p.stderr.on('data',d=>{log+=d})
    p.on('exit',code=>resolve({code,log}))
  })
  writeFileSync(`shots/${name}.log`,r.log);results.push({...j,mode,code:r.code})
  console.log(`${r.code===0?'PASS':'FAIL'} ${name}${r.code===0?'':'\n'+r.log}`)
}}
await Promise.all([worker(),worker()])
writeFileSync(`shots/${mode}${process.argv[3]?"-"+scenes.join("-"):""}-summary.json`,JSON.stringify(results,null,2)+'\n')
process.exitCode=results.every(r=>r.code===0)?0:1
