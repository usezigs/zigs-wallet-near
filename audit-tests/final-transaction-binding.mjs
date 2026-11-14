// Audit-only characterization of the actual production boundary, with inert dependencies.
// No real private keys, signature shares, blockchain RPC or valid spend bytes are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const file=new URL('../web/app-payments.js', import.meta.url);
const source=readFileSync(file,'utf8');
const start=source.indexOf('export const approvedTxid =');
const end=source.indexOf('// Tries each server in turn,',start);
assert.ok(start>0&&end>start);
const production=source.slice(start,end).replaceAll('export ','');
const sends=[],updates=[],banners=[];
const APPROVED='a'.repeat(64),ACTUAL='b'.repeat(64);
const fixture={id:'audit-only-session',pczt:'synthetic-approved-pczt',final:{txid:APPROVED,tx_hex:'deadbeef'}};
const context={state:{gid:'audit-only-wallet'},isStr:x=>typeof x==='string',
 markOf:()=>({approved:'synthetic-approved-pczt'}),afterOf:()=> 'synthetic-approved-pczt',
 txidOf:()=>APPROVED,swapSendRefusal:()=>null,
 sdb:{doc:path=>({update:async value=>updates.push({path,value})})},
 sessionPath:ss=>'groups/audit-only-wallet/sessions/'+ss.id,
 sigPart:async()=>({sentBy:1,sentSig:'synthetic-document-signature'}),
 broadcastAnywhere:async bytes=>{sends.push(bytes);return{txid:ACTUAL};},
 curChain:()=>null,runSync:()=>{},log:()=>{},
 showBanner:(kind,message)=>banners.push({kind,message}),Date,
 fixture,result:null};
vm.createContext(context);
await vm.runInContext(production+'\n(async()=>{result={refusal:sendRefusal(fixture)};await broadcastTx(fixture);})()',context);
assert.equal(context.result.refusal,null,'claimed approved ID passes despite unrelated opaque bytes');
assert.deepEqual(sends,['deadbeef']);
assert.equal(updates.length,1);
assert.equal(updates[0].value.broadcastTxid,APPROVED);
assert.notEqual(updates[0].value.broadcastTxid,ACTUAL);
const evidence={result:'CONFIRMED boundary defect',scope:'Actual production approvedTxid/sendRefusal/broadcastTx functions executed unchanged; cryptography, storage and network dependencies are inert fixtures.',
 suppliedFinalMetadata:APPROVED,mockedNodeReturnedId:ACTUAL,recordedBroadcastId:updates[0].value.broadcastTxid,
 acceptedOpaqueBytes:true,displayedSubmittedMessage:banners.some(b=>b.message.startsWith('Submitted')),
 limitation:'This proves missing byte/ID validation and incorrect success identity at the application boundary. It does not demonstrate a forged threshold signature or acceptance of invalid bytes by a real chain.'};
console.log(JSON.stringify(evidence,null,2));

// Fail the expected secure invariant; keep the exploit characterization above visible.
assert.ok(context.result.refusal !== null || sends.length === 0,
  'Security invariant failed: raw transaction bytes were not bound to the approved transaction before broadcast.');
