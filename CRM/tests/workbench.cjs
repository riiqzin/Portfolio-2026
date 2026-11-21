/* Offline visual/interaction checks. Every API and external request is intercepted. */
const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
const artifacts=process.env.CRM_ARTIFACTS||path.join(__dirname,'artifacts');
fs.mkdirSync(artifacts,{recursive:true});
const statuses=['novo','abordado','respondeu','interessado','proposta','fechou','sem_interesse'];
let leads=statuses.map((status,i)=>({id:String(i+1),name:['Barbearia Alameda','Estúdio Linha Fina','Clínica Aurora','Casa do Corte','Barbearia Horizonte','Estética Essência','Studio Forma'][i],city:'São Paulo · Pinheiros',phone:'11999990000',email:'contato@example.test',website:'https://example.test',status,channel:'whatsapp',offer:'landing',angle:'A',verified:{},notes:'Atendimento com hora marcada.',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),contacted_at:i?new Date().toISOString():null}));
const candidate={place_id:'fixture-place',name:'Barbearia Vila Nova',city:'São Paulo',address:'Rua das Flores, 90',phone:'11999991111',rating:4.6,reviews:24,candidate:true,match_type:'landing',website:'',verified:{}};
const quota={used:12,limit:200,remaining:188};
const costs={updatedAt:new Date().toISOString(),openai:{official:true,billedAmount:1.28,connected:true,budget:{limitCents:500,reservedCents:125,percentage:25},requestsMonth:quota,requestsDay:quota},places:{connected:true,callsMonth:quota,callsDay:quota,scansMonth:quota},brave:{connected:true,requestsMonth:quota,requestsDay:quota},upstash:{connected:true},vercel:{connected:true}};
const onboarding={id:'fixture-onboarding',company:'Barbearia Alameda',segment:'Barbearia',status:'recebido',createdAt:new Date().toISOString(),submittedAt:new Date().toISOString(),answers:{services:'Corte — R$ 45\nBarba — R$ 30',hours:'Segunda a sábado, 9h às 19h',payments:['Pix','Cartão'],address:'Rua das Flores, 90',knowledge:{features:{},policies:{},details:{}}}};
const errors=[],calls=[],blocked=[];
let failCosts=false;
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]).replace(/\/$/,'/index.html'));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404).end()}
});
(async()=>{
 await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:process.env.CRM_BROWSER_CHANNEL||'msedge',headless:true});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  const reply=(json,status=200)=>route.fulfill({status,json,headers:{'access-control-allow-origin':'*'}});
  if(url.hostname.endsWith('.supabase.co')){
   const body=req.postDataJSON(),fn=url.pathname.split('/').pop();calls.push({fn,body});
   if(body.p_key!=='fixture-key')return reply({message:'Invalid key'},401);
   if(fn==='crm_local_list')return reply(leads);
   if(fn==='crm_local_history')return reply([]);
   if(fn==='crm_local_save'){const item={...body.p_data,id:body.p_data.id||'new-fixture'};leads=leads.filter(x=>x.id!==item.id).concat(item);return reply(item)}
   if(fn==='crm_local_action'){const item=leads.find(x=>x.id===body.p_lead_id);item.status=body.p_type;return reply(item)}
   if(fn==='crm_local_delete'){leads=leads.filter(x=>x.id!==body.p_lead_id);return reply({ok:true})}
   throw new Error('Unhandled RPC '+fn);
  }
  if(url.hostname!=='127.0.0.1'){blocked.push(req.url());return route.abort()}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  calls.push({api:url.pathname,method:req.method()});
  if(url.pathname==='/api/local-radar'){
   if(req.method()==='GET')return reply({ready:true,dailyLimit:5,maxCallsPerScan:8,monthlyCallLimit:200});
   await new Promise(resolve=>setTimeout(resolve,180));
   return reply({results:[candidate],calls:1,unique:1,matched:1,stopReason:'exhausted',usage:{daily:1,monthly:1}});
  }
  if(url.pathname==='/api/costs')return failCosts?reply({message:'Fixture: indisponível'},503):reply(costs);
  if(url.pathname==='/api/gmail')return reply({connected:false,canSend:false,items:[]});
  if(url.pathname==='/api/outreach')return reply({queue:[],items:[]});
  if(url.pathname==='/api/onboarding'){
   if(url.searchParams.has('token'))return reply({company:'Barbearia Alameda',segment:'Barbearia'});
   if(url.searchParams.has('lab'))return reply({used:0,remaining:10,limit:10});
   if(url.searchParams.has('prompt'))return reply({prompt:'',ready:false});
   if(req.method()==='POST')return reply({url:'https://example.test/onboarding?token=fixture'});
   return reply({items:[onboarding]});
  }
  throw new Error('Unhandled API '+url.pathname);
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:4175/CRM/');
 await page.locator('#loginKey').fill('wrong');await page.locator('#loginForm button').click();await expect(page.locator('#loginError')).toContainText('Senha incorreta');
 await page.locator('#loginKey').fill('fixture-key');await page.locator('#loginForm button').click();await expect(page.locator('#authOverlay')).toBeHidden();
 await expect(page.locator('#statLeads')).toHaveText('7');
 const pages=['central','radar','hoje','abordagens','clientes','implantacoes','custos'];
 for(const section of pages){
  await page.locator(`[data-nav="${section}"]`).click();await expect(page.locator(`#page-${section}`)).toBeVisible();
  if(section==='custos')await expect(page.locator('.costs-service')).toHaveCount(5);
  if(section==='implantacoes')await expect(page.locator('.onboard-item')).toHaveCount(1);
  await page.screenshot({path:path.join(artifacts,`${section}-desktop.png`),fullPage:true});
 }
 await page.locator('[data-nav=clientes]').click();await expect(page.locator('.pipeline-lane')).toHaveCount(7);await expect(page.locator('.client-row')).toHaveCount(7);
 await page.locator('#clientSearch').fill('Alameda');await expect(page.locator('.client-row')).toHaveCount(1);await page.locator('#clientSearch').fill('');
 await page.locator('#clientStatus').selectOption('proposta');await expect(page.locator('.client-row')).toHaveCount(1);await page.locator('#clientStatus').selectOption('all');
 await page.locator('[data-client-view=list]').click();await expect(page.locator('.pipeline-lane')).toHaveCount(0);await expect(page.locator('.client-row')).toHaveCount(7);
 await page.locator('[data-client-view=board]').click();
 await page.locator('.client-row').first().getByRole('button').click();await expect(page.locator('#leadOverlay')).toBeVisible();
 await page.locator('#leadNotes').fill('Observação atualizada no teste.');await page.locator('#saveLead').click();await expect(page.locator('#toast')).toContainText('salvo');
 await page.locator('#markResponse').click();await page.locator('.status-buttons').getByRole('button',{name:'Interessado',exact:true}).click();await expect(page.locator('.client-row[data-lead-id="1"]')).toHaveAttribute('data-status','interessado');
 await page.screenshot({path:path.join(artifacts,'lead-desktop.png'),fullPage:true});
 await page.locator('#closeLead').click();await expect(page.locator('#leadOverlay')).toBeHidden();
 await page.locator('#addClient').click();await page.locator('#leadName').fill('Negócio de teste');await page.locator('#saveLead').click();await expect(page.locator('#toast')).toContainText('salvo');await page.locator('#closeLead').click();
 await expect(page.locator('.client-row')).toHaveCount(8);
 await page.locator('[data-nav=radar]').click();
 await page.locator('[data-scroll-target]').click();await expect(page.locator('#page-radar')).toBeVisible();expect(new URL(page.url()).hash).toBe('#radar');
 await page.locator('#openCountryGlobe').click();await expect(page.locator('#countryGlobeModal')).toBeVisible();
 await page.locator('[data-globe-country=PT]').click();await expect(page.locator('#localCountry')).toHaveValue('PT');
 await page.screenshot({path:path.join(artifacts,'globe-desktop.png'),fullPage:true});
 await page.locator('#globeApply').click();await expect(page.locator('#countryGlobeModal')).toBeHidden();
 await page.locator('#runLocal').click();await expect(page.locator('.prospect')).toHaveCount(1);await expect(page.locator('#scopeState')).toHaveText('VARREDURA FINALIZADA');
 await page.locator('#radarSearch').fill('não existe');await expect(page.locator('.prospect')).toHaveCount(0);await page.locator('#resetRadarFilters').click();await expect(page.locator('.prospect')).toHaveCount(1);
 await expect(page.locator('.archive-item')).toHaveCount(1);await page.locator('.archive-item').click();await expect(page.locator('.prospect')).toHaveCount(1);
 await page.locator('[data-nav=abordagens]').click();const template=page.locator('.template').first();await template.getByRole('button',{name:'Editar',exact:true}).click();await template.locator('textarea').fill('Mensagem personalizada.');await template.getByRole('button',{name:'Salvar',exact:true}).click();await expect(template.locator('p')).toHaveText('Mensagem personalizada.');
 await page.locator('[data-nav=implantacoes]').click();await page.locator('.onboard-item summary').first().click();await expect(page.locator('.onboard-item-body')).toBeVisible();await page.screenshot({path:path.join(artifacts,'assistant-desktop.png'),fullPage:true});
 await page.locator('[data-nav=custos]').click();failCosts=true;await page.locator('#refreshCosts').click();await expect(page.locator('#costsError')).toContainText('indisponível');failCosts=false;await page.locator('#refreshCosts').click();await expect(page.locator('.costs-service')).toHaveCount(5);
 // Every private route at four viewport widths, with reduced motion enforced.
 for(const width of [320,390,768,820,1440]){
  await page.setViewportSize({width,height:950});
  for(const section of pages){await page.evaluate(section=>{location.hash=section},section);await expect(page.locator(`#page-${section}`)).toBeVisible();
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);expect(overflow,`${section} overflows at ${width}`).toBe(false);
   if(width===390)await page.screenshot({path:path.join(artifacts,`${section}-mobile.png`),fullPage:true});
  }
 }
 await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-nav=central]').click();await expect(page.locator('#page-central')).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
 await page.goto('http://127.0.0.1:4175/CRM/onboarding.html?token=fixture');await expect(page.locator('#form')).toBeVisible();
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),`intake overflow ${width}`).toBe(false);await page.screenshot({path:path.join(artifacts,`intake-${width}.png`),fullPage:true})}
 expect(errors).toEqual([]);expect(blocked).toEqual([]);
 console.log(JSON.stringify({passed:true,routes:pages.length,viewports:[320,390,768,1440],mockCalls:calls.length,realApiCalls:0,errors},null,2));
 }finally{await browser.close();server.close()}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
