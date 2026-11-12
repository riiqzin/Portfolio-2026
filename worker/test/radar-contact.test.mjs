import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../../api/radar-contact.js';
import {ticket} from '../../lib/radar-control.js';

const env={
 RADAR_DASHBOARD_KEY:'test-key-with-no-user-secrets',
 UPSTASH_REDIS_REST_URL:'https://testdb.upstash.io',
 UPSTASH_REDIS_REST_TOKEN:'fake'
};
const redisFetch=async (url,init)=>{
 assert.equal(url,env.UPSTASH_REDIS_REST_URL);
 const [cmd]=JSON.parse(init.body);
 const value={GET:null,INCR:1,EXPIRE:1,SET:'OK'}[cmd];
 return Response.json({result:value});
};
const ask=(domain,proof)=>new Request('https://portfolio-ricky-mangini.vercel.app/api/radar-contact',{
 method:'POST',headers:{Authorization:'Bearer '+env.RADAR_DASHBOARD_KEY,'Content-Type':'application/json'},
 body:JSON.stringify({domain,ticket:proof})
});
test('signed public search result can be enriched with a contact, cached and returned',async()=>{
 let calls=0;
 const handler=createHandler({env,fetcher:redisFetch,inspector:async()=>{
  calls++;return {status:'scanned',domain:'lojaexemplo.com.br',emails:['contato@lojaexemplo.com.br'],platform:'Não identificada',score:80};
 }});
 const res=await handler(ask('lojaexemplo.com.br',ticket('https://lojaexemplo.com.br/',env)));
 assert.equal(res.status,200);
 assert.equal((await res.json()).emails[0],'contato@lojaexemplo.com.br');
 assert.equal(calls,1);
});
test('contact lookup rejects unsigned arbitrary domain without hitting scraper',async()=>{
 let calls=0;
 const handler=createHandler({env,fetcher:redisFetch,inspector:async()=>{calls++;return {emails:[]}}});
 const res=await handler(ask('example.com','invalid-ticket'));
 assert.equal(res.status,400);
 assert.equal(calls,0);
});
test('contact lookup requires dashboard authentication',async()=>{
 const handler=createHandler({env,fetcher:redisFetch});
 const res=await handler(new Request('https://portfolio-ricky-mangini.vercel.app/api/radar-contact',{method:'POST'}));
 assert.equal(res.status,401);
});
