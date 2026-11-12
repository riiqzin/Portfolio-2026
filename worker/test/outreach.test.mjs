import test from 'node:test';
import assert from 'node:assert/strict';
import {sendGmail} from '../../api/outreach.js';

test('approved outreach produces MIME message with exact recipient and no automatic sending',async()=>{
 let called=0;
 const mail={email:'contato@lojaexemplo.com.br',subject:'Uma ideia para Loja Exemplo',text:'Oi! Tudo bem?\nGostaria de conversar.'};
 const result=await sendGmail('fake-token',mail,async(url,init)=>{
  called++;
  assert.match(url,/gmail\/v1\/users\/me\/messages\/send$/);
  assert.equal(init.method,'POST');
  assert.equal(init.headers.Authorization,'Bearer fake-token');
  const payload=JSON.parse(init.body);
  const mime=Buffer.from(payload.raw,'base64url').toString('utf8');
  assert.match(mime,/To: <contato@lojaexemplo\.com\.br>/);
  assert.match(mime,/From: Ricky CRM <rickymanginidev@gmail\.com>/);
  assert.match(mime,/Content-Type: text\/plain; charset="UTF-8"/);
  const body=Buffer.from(mime.split('\r\n\r\n')[1]||'','base64').toString('utf8');
  assert.match(body,/Se preferirem não receber mais contatos/);
  return {ok:true,json:async()=>({id:'mock-gmail-msg',threadId:'mock-thread'})};
 });
 assert.equal(called,1);
 assert.equal(result.id,'mock-gmail-msg');
});
test('Gmail must confirm a sent message id',async()=>{
 await assert.rejects(()=>sendGmail('fake',{email:'a@b.com',subject:'x',text:'y'},async()=>({ok:true,json:async()=>({})})),/send_unconfirmed/);
});
