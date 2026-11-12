import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWebsite, normalizePlace, createHandler} from '../../api/local-radar.js';

const env={RADAR_DASHBOARD_KEY:'test-dashboard-key',UPSTASH_REDIS_REST_URL:'https://db-test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'fake',GOOGLE_PLACES_API_KEY:'fake-places-key'};
const req=(body)=>new Request('https://crm.example.com/api/local-radar',{method:'POST',headers:{Authorization:'Bearer '+env.RADAR_DASHBOARD_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});

test('local classifier labels links without claiming lack of site from a social URL',()=>{
 assert.equal(classifyWebsite('https://www.instagram.com/barbearia/'),'social');
 assert.equal(classifyWebsite('https://linktr.ee/barbearia'),'bio');
 assert.equal(classifyWebsite('https://wa.me/5511988887777'),'whatsapp');
 assert.equal(classifyWebsite('https://booksy.com/barbearia'),'booking');
 assert.equal(classifyWebsite('https://barbearia.com.br'),'own');
 assert.equal(classifyWebsite(''),'none');
});
test('probable mobile is not presented as confirmed WhatsApp',()=>{
 const p=normalizePlace({id:'ChIJ123',displayName:{text:'Barbearia Exemplo'},nationalPhoneNumber:'(11) 98888-7777',websiteUri:'https://instagram.com/teste',businessStatus:'OPERATIONAL',rating:4.7,userRatingCount:58});
 assert.equal(p.link_type,'social');
 assert.equal(p.mobile_probable,true);
 assert.equal(Object.hasOwn(p,'whatsapp_confirmed'),false);
 assert.equal(p.rating,4.7);
});
test('no Google key returns explicit unavailable state without a mock search',async()=>{
 const handler=createHandler({env:{...env,GOOGLE_PLACES_API_KEY:''},fetcher:()=>{throw Error('must not call')}}); 
 const status=await handler(new Request('https://crm.example.com/api/local-radar',{headers:{Authorization:'Bearer '+env.RADAR_DASHBOARD_KEY}}));
 assert.equal((await status.json()).ready,false);
 const res=await handler(req({niche:'Barbearias',city:'São Paulo'}));
 assert.equal(res.status,503);
});
test('authorized search returns genuine mapped data and never invents absent website',async()=>{
 let calls=0;
 const fetcher=async (url,init)=>{
  calls++;
  if(String(url).includes('upstash.io'))return Response.json({result:[1,1,1]});
  assert.equal(url,'https://places.googleapis.com/v1/places:searchText');
  assert.equal(init.headers['X-Goog-Api-Key'],env.GOOGLE_PLACES_API_KEY);
  return Response.json({places:[{id:'place-A',displayName:{text:'Barbearia do Bairro'},formattedAddress:'São Paulo, Brasil',businessStatus:'OPERATIONAL',rating:4.8,userRatingCount:120,nationalPhoneNumber:'(11) 98888-7777'}]});
 };
 const res=await createHandler({env,fetcher})(req({niche:'Barbearias',city:'São Paulo'}));
 assert.equal(res.status,200);
 const data=await res.json();
 assert.equal(data.results[0].link_type,'none');
 assert.equal(data.results[0].place_id,'place-A');
 assert.equal(data.results[0].mobile_probable,true);
 assert.equal(calls,2);
});
test('unauthorized request is rejected before provider lookup',async()=>{
 const handler=createHandler({env,fetcher:()=>{throw Error('provider not allowed')}});
 const res=await handler(new Request('https://crm.example.com/api/local-radar',{method:'POST'}));
 assert.equal(res.status,401);
});