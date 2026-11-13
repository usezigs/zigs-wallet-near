// Adapted from the copied hero-demo: once playback, authored beats, measured targets.
// Fixed illustrative state only. Production modules, keys and services are never imported.
import { Avatar, Badge, Button, Card, Check, Field, Phone, Row, Stage, States, Text, Window, type Act } from '../kit'
import type { ReactNode } from 'react'
import './scene.css'
export const stories = {
  payment:['Propose a payment','Review the exact payment, then request approvals.'],
  approvals:['Approve together','Contributions arrive without losing the payment context.'],
  setup:['Set up and verify','Rule, safety comparison and address check remain distinct.'],
  receive:['Receive with confidence','Copy confirms a destination. It does not imply a deposit.'],
  messages:['Coordinate, then propose','A conversation leads into review. A message is not an approval.'],
  recovery:['Save and check a backup','Saving a file and checking it are separate steps.'],
} as const
export type Story = keyof typeof stories
type S = {step:number;amount:string}
const initial:S={step:0,amount:''}, poster:S={step:3,amount:'0.01234567'}
const address='utest1demo9k7x2m4j6q8s0d5f3g7h9c2r4t6w8y0z5n3p7a9e2u4v6k8x0s5d3j7f9q2m4r6t8w0g5h3c7n9p2e4v6k8x0s5d3j7f' // Deliberately invalid; never a fundable destination.
const labels:Record<Story,string[]>={
  payment:['Choose recipient','Review payment','Request approvals','View request'],
  approvals:['Review request','Approve on this device','Waiting for approvals','View signing progress'],
  setup:['Use this rule','Compare safety code','Check wallet address','Open wallet'],
  receive:['Choose ZEC','Inspect destination','Copy address','Copy again'],
  messages:['Open request','Inspect request','Open in Send','Review payment'],
  recovery:['Save recovery file','Choose saved file','Check this file','Back to Security'],
}
function choreography(story:Story){return async(a:Act<S>)=>{
  await a.wait(1100); a.mark('inspect'); await a.click({at:'next',x:0.15,y:0.5}); a.put({step:1})
  await a.wait(2100)
  if(story==='payment'){
    await a.click('amount'); await a.type('amount','0.01234567',{interval:75}); await a.wait(700)
  }
  a.mark('review'); await a.click({at:'next',x:0.15,y:0.5}); a.put({step:2}); await a.wait(2400)
  a.mark('payoff');
  if(story!=='approvals')await a.click({at:'next',x:0.15,y:0.5})
  a.put({step:3}); await a.wait(3200)
}}
export default function PaymentScene({story='payment',theme='light',still=false,opening=false}:
  {story?:Story;theme?:'light'|'dark';still?:boolean;opening?:boolean}){
  return <Stage<S> width={720} height={660} compact={{below:600,width:358,height:650}}
    className="zs" theme={theme} fidelity="realistic" initial={opening?initial:still?poster:initial}
    poster={opening?initial:poster} script={still||opening?undefined:choreography(story)} play="once"
    cursor={still||opening?undefined:{at:{wide:{x:690,y:550},compact:{x:342,y:640}},style:{wide:"real",compact:"touch"},idle:1200}}>
    {(s,_rect,layout)=>layout==='compact'
      ? <Phone width={326} frame="pro" dark={theme==='dark'} className="zs-phone">
          <div className="zs-phone-body"><Screen story={story} s={s}/></div>
        </Phone>
      : <Window url="app.zigs.app" className="zs-window"><div className="zs-layout">
          <aside className="zs-rail">
            <img src={new URL("../../../logo.png",import.meta.url).href} width="30" height="30" alt=""/>
            <Text className="zs-rail-name">Household</Text><Text className="zs-caption">Shared wallet</Text>
            <div className="zs-nav">{['Overview','Approvals','Activity','Address book','Swap','Messages','Security','Settings'].map(name=>
              <Row key={name} pad={8} title={name} selected={name===nav(story)}/>)}</div>
            <Text className="zs-rail-note" wrap>2 of 3 devices · Zcash Testnet</Text>
          </aside><Screen story={story} s={s}/>
        </div></Window>}
  </Stage>
}
const nav=(s:Story)=>({payment:'Overview',approvals:'Approvals',setup:'Security',receive:'Overview',messages:'Messages',recovery:'Security'})[s]
function Screen({story,s}:{story:Story;s:S}){
  return <div className="zs-screen"><div className="zs-heading">
    <Text className="zs-context">Household wallet · Zcash Testnet</Text>
    <Text className="zs-title">{stories[story][0]}</Text></div>
    <div className="zs-content">
      {story==='payment'&&<Payment s={s}/>}{story==='approvals'&&<Approvals s={s}/>}
      {story==='setup'&&<Setup s={s}/>}{story==='receive'&&<Receive s={s}/>}
      {story==='messages'&&<Messages s={s}/>}{story==='recovery'&&<Recovery s={s}/>}
    </div><div className="zs-action"><States value={s.step===3?"result":story==="approvals"&&s.step===2?"waiting":"hint"} align="start" states={{waiting:<Text className="zs-caption" wrap>{story==="approvals"?"This device approved. Another device must still approve.":meaning(story,0)}</Text>,hint:<Text className="zs-caption" wrap>{meaning(story,0)}</Text>,result:<Text className="zs-caption" wrap>{meaning(story,3)}</Text>}}/>
      <Button variant={story==="approvals"&&s.step===2?"secondary":"primary"} aria-disabled={story==="approvals"&&s.step===2||undefined} size="large" className="zs-next" data-target="next"><States value={String(s.step)} states={Object.fromEntries(labels[story].map((label,i)=>[String(i),<span>{label}</span>]))}/></Button>
    </div><div className="zs-footer">Illustration · sample data · no funds move</div></div>
}
function Amount({label,children}:{label:string;children:ReactNode}){
  return <div className="zs-amount-block"><Text className="zs-caption">{label}</Text>
    <span className="zs-amount">{children}</span></div>
}
function Facts({pairs}:{pairs:[string,ReactNode][]}){
  return <div className="zs-facts">{pairs.map(([label,value])=>
    <Row key={label} pad={8} title={label} meta={value}/>)}</div>
}
function Person({conversation=false}:{conversation?:boolean}){return <Row pad={12} lead={<Avatar name="Alex Rivera" size={30}/>}
  title="Alex Rivera" subtitle={conversation?"Household conversation":"Saved recipient · local label"}/>}
function Status({on,yes,no}:{on:boolean;yes:string;no:string}){return <States value={on?"yes":"no"} align="start" states={{yes:<span>{yes}</span>,no:<span>{no}</span>}}/>}
function Payment({s}:{s:S}){return <><Person/>
  <Field label="Amount · ZEC" value={s.amount} placeholder="0.00" focused={s.step===1} typing={s.step===1} box={{'data-target':'amount'}}/>
  <Facts pairs={[
    ['Recipient memo','November supplies'],['Network fee','0.0001 ZEC'],['Approvals needed','2 of 3 devices'],
  ]}/><Card tone="sunken" pad="small" gap={8}>
    <Text className="zs-caption">Total leaving the wallet</Text><span className="zs-total"><States value={s.step>=2?"total":s.amount?"review":"enter"} align="start" states={{total:<span>0.01244567 ZEC</span>,review:<span>Review to see total</span>,enter:<span>Enter an amount</span>}}/></span>
    <States value={s.step===3?"waiting":"review"} align="start" states={{waiting:<span>Request shared · waiting for 2 approvals</span>,review:<span>Review the amount before requesting approvals</span>}}/>
  </Card></>}
function Approvals({s}:{s:S}){return <>
  <Amount label="November supplies · Alex Rivera">0.01234567 ZEC</Amount>
  <Facts pairs={[[ 'Network fee','0.0001 ZEC'],['Required','2 of 3 devices']]}/>
  <Card pad="small" gap={0} tone="sunken">
    <Row pad={8} title="This laptop" subtitle="Device 1" meta={<Status on={s.step>=2} yes="Approved" no="Needs review"/>}/>
    <Row pad={8} title="Alex’s phone" subtitle="Device 2" meta={<Status on={s.step===3} yes="Approved" no="Waiting"/>}/>
    <Row pad={8} title="Recovery device" subtitle="Device 3" meta={<Status on={s.step===3} yes="Not required" no="Available"/>}/>
  </Card><div className="zs-result"><Check on={s.step===3} size={18}/>
    <States value={s.step===3?"ready":s.step===2?"waiting":"review"} align="start" states={{ready:<span>2 approvals · signing follows</span>,waiting:<span>1 approval · waiting</span>,review:<span>Review before approving</span>}}/></div></>}
function Setup({s}:{s:S}){return <><Amount label="Approval rule">2 of 3 devices</Amount>
  <Facts pairs={[[ 'Invitation','3 devices joined'],['Wallet','Household']]}/>
  <Card tone="sunken" pad="small" gap={0}>
    <Text className="zs-caption">Compare the full code on every device</Text>
    <span className="zs-code"><Status on={s.step>=1} yes="81245 39102 65380 74619 52084 96731" no="Waiting for the devices to join"/></span>
  </Card>
  <Row pad={12} lead={<Check on={s.step>=2} size={18}/>} title="Safety code" meta={<Status on={s.step>=2} yes="Matches" no="Compare"/>}/>
  <Row pad={12} lead={<Check on={s.step===3} size={18}/>} title="Wallet address" meta={<Status on={s.step===3} yes="Checked here" no="Not checked yet"/>}/></>}
function Receive({s}:{s:S}){return <>
  <Row pad={12} lead={<img src={new URL("../../../assets/zcash.svg",import.meta.url).href} width="28" height="28" alt=""/>}
    title="Receive ZEC" subtitle="Zcash Testnet · shielded address"/>
  <Card tone="sunken" pad="small" gap={12}><Text className="zs-caption">Sample destination · do not send funds</Text>
    <Text className="zs-code" wrap>{address}</Text></Card>
  <Facts pairs={[[ 'Network','Zcash Testnet only'],['Spendable after','3 confirmations']]}/>
  <div className="zs-result"><Check on={s.step===3} size={18}/>
    <Status on={s.step===3} yes="Address copied" no="Inspect the full destination"/></div>
  <Text className="zs-caption" wrap>Incoming funds become available after confirmation.</Text></>}
function Messages({s}:{s:S}){return <><Person conversation/>
  <Text className="zs-message" wrap>Can we pay for November’s supplies?</Text>
  <Card pad="medium" gap={12} tone="sunken"><Text className="zs-caption">Payment request · from Alex</Text>
    <Text className="zs-total">0.01234567 ZEC</Text><Text className="zs-caption">November supplies</Text>
    <Badge tone="neutral" style={{justifySelf:"start"}}>Request only</Badge></Card>
  <Facts pairs={[[ 'Recipient','Alex Rivera'],['Next step',s.step===3?'Review in Send':'Inspect request']]}/>
  <Text className="zs-caption" wrap>Review the full destination and costs in Send.</Text></>}
function Recovery({s}:{s:S}){return <><Amount label="Recovery material">This device</Amount>
  <Row pad={12} title="Device 1 · Zcash" subtitle="Encrypted file and separate passphrase"/>
  <Card tone="sunken" pad="small" gap={8}>
    <Row pad={8} title="Household-device-1.zigs" subtitle={<Status on={s.step>=1} yes="Saved recovery file" no="Save this device’s file"/>}/>
    <Field label="Passphrase" value="sample passphrase only" password/>
  </Card><Row pad={12} lead={<Check on={s.step===3} size={18}/>} title="File check"
    meta={<Status on={s.step===3} yes="Matches this device" no="Not checked yet"/>}/>
  <Text className="zs-caption" wrap>Other devices have their own recovery material. A checked file has not been restored.</Text></>}
function meaning(story:Story,step:number){
  if(step<3)return 'Review each detail before continuing.'
  return {payment:'Requesting approvals does not sign or send this payment.',
    approvals:'Approvals are complete. Signing and sending still follow.',
    setup:'This device checked the address. Keep recovery material separately.',
    receive:'The acknowledgement confirms only the copy action.',
    messages:'Continue in Send to inspect the full payment before proposing.',
    recovery:'This file matches this device. Other backups remain separate.'}[story]
}
