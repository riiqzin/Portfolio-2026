import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,authUrl,tidyLeads,classifyBasic,ADDRESS,REDIRECT} from '../../lib/gmail.js';

const env={RADAR_DASHBOARD_KEY:'test-dashboard-key-with-adequate-length',GOOGLE_CLIENT_ID:'example.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'not-a-real-secret'};
test('gmail refresh token stays encrypted in Redis representation',()=>{
 const secret={email:ADDRESS,refresh:'sensitive-token'};
 const saved=seal(secret,env);
 assert.ok(!saved.includes(secret.refresh));
 assert.deepEqual(unseal(saved,env),secret);
 assert.throws(()=>unseal(saved,{...env,RADAR_DASHBOARD_KEY:'wrong'}));
});
test('gmail OAuth start requests only mailbox read with fixed callback and offline access',()=>{
 const url=new URL(authUrl('state123',env));
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('redirect_uri'),REDIRECT);
 assert.equal(url.searchParams.get('access_type'),'offline');
 assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly');
 assert.equal(url.searchParams.get('login_hint'),ADDRESS);
});
test('gmail lead snapshot rejects invalid IDs and email addresses',()=>{
 const result=tidyLeads([{id:'123e4567-e89b-12d3-a456-426614174000',name:'Store',email:'hello@example.com,bad,abc@test.com',sentAt:'2026-11-12T10:00:00Z'},{id:'bad',email:'foo@example.com'}]);
 assert.equal(result.length,1);
 assert.deepEqual(result[0].emails,['hello@example.com','abc@test.com']);
});
test('gmail classifications respect explicit refusal, commercial requests and autoresponders',()=>{
 assert.equal(classifyBasic('','Não temos interesse.').label,'Sem interesse');
 assert.equal(classifyBasic('','Pode enviar orçamento?').priority,'alta');
 assert.equal(classifyBasic('','Volto mês que vem.').label,'Contato futuro');
 assert.equal(classifyBasic('','',{ 'auto-submitted':'auto-replied' }).label,'Automático');
});