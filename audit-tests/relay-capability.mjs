// Bounded audit-only characterization against a disposable loopback Worker.
// Two isolated WebSocket clients; three small writes; random namespace only.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
assert.ok(process.argv[2], 'Supply a disposable audit Worker URL explicitly');
const base = new URL(process.argv[2]);
assert.ok(!['8787', '8788'].includes(base.port), 'Do not target the existing developer services');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(base.hostname), 'loopback audit server only');
assert.ok(['ws:','wss:'].includes(base.protocol));
const group = randomBytes(10).toString('hex');
const endpoint = new URL('/ws',base); endpoint.searchParams.set('g',group);
const path='groups/'+group+'/meta/wallet';
const clients=[];
async function connect(){
 const ws=new WebSocket(endpoint);clients.push(ws);
 let next=0;const waiting=new Map(),updates=[];
 const initialized=new Promise((resolve,reject)=>{
  ws.addEventListener('error',()=>reject(new Error('ephemeral relay unavailable')),{once:true});
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
   if(m.type==='init')resolve(m.docs);
   if(m.type==='reply'){const item=waiting.get(m.rid);if(item){clearTimeout(item.timer);waiting.delete(m.rid);item.resolve(m);}}
   if(m.type==='put')updates.push(m);
  });
 });
 const initial=await Promise.race([initialized,new Promise((_,reject)=>setTimeout(()=>reject(new Error('init timeout')),5000))]);
 return {initial,updates,send:msg=>new Promise((resolve,reject)=>{
  const rid=++next,timer=setTimeout(()=>{waiting.delete(rid);reject(new Error('reply timeout'));},5000);
  waiting.set(rid,{resolve,timer});ws.send(JSON.stringify({...msg,rid}));
 })};
}
try{
 const legitimate=await connect();assert.equal(legitimate.initial.length,0);
 // Disposable encryption material stays local; neither handshake contains it.
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('synthetic audit wallet metadata'));
 const original={name:Buffer.from(ciphertext).toString('base64'),nonce:Buffer.from(iv).toString('base64')};
 assert.equal((await legitimate.send({op:'set',path,data:original})).ok,true);
 // A different client receives only the namespace id, never key, plaintext or credentials.
 const unrelated=await connect();
 const observed=unrelated.initial.find(d=>d.path===path)?.data;
 assert.deepEqual(observed,original);
 const corrupt={name:'invalid-synthetic-ciphertext',nonce:'invalid-synthetic-nonce'};
 assert.equal((await unrelated.send({op:'set',path,data:corrupt})).ok,true);
 const observer=await connect();
 assert.deepEqual(observer.initial.find(d=>d.path===path)?.data,corrupt);
 assert.equal((await unrelated.send({op:'set',path,data:observed})).ok,true);
 const evidence={result:'CONFIRMED documented relay capability',loopbackOnly:true,randomDisposableNamespace:true,
  walletSecretProvidedToUnrelatedClient:false,authenticationHeadersProvided:false,
  ciphertextVisibleWithoutSecret:true,overwriteAcceptedWithoutSecret:true,reconnectReturnsCorruptedRecord:true,
  replayOfObservedCiphertextAccepted:true,smallWrites:3,
  limitation:'No actual wallet records, real signing keys, valid approval forgeries, transaction submissions, capacity exhaustion, or production endpoints were used. This confirms relay write/availability behavior, not ciphertext decryption or theft.'};
 console.log(JSON.stringify(evidence,null,2));
}finally{for(const ws of clients)ws.close();}
