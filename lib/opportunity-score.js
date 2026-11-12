// Evidence-first opportunity scoring. No AI and no visual/aesthetic claims.
// Unknown evidence does NOT count as a detected problem.
export function evaluateOpportunity({domain,html='',pages=[],emails=[],platform='Não identificada'}={}){
 const source=String(html||'');
 const samples=[source,...pages.filter(Boolean).map(String)];
 const combined=samples.join('\n').slice(0,500000).toLowerCase();
 const checks=[];
 const add=(group,points,max,label,verified,detail)=>checks.push({group,points,max,label,status:verified?'verified':'unknown',detail});
 const isStore=/(?:\b(?:carrinho|adicionar ao carrinho|comprar agora|finalizar compra|meu carrinho|shopping cart)\b|\/(?:products?|produtos?|collections?|colecoes?|categoria|categorias)\/)/i.test(combined);
 const hasCatalog=/(?:\b(?:produtos|colecion[aá]veis|categorias|cat[aá]logo|cole[cç][aã]o|lan[cç]amentos)\b|\/(?:products?|produtos?|collections?|categorias?)\/)/i.test(combined);
 const platformKnown=platform!=='Não identificada';
 const blocked=/Nuvemshop/i.test(platform);
 const hasViewport=/<meta\b[^>]*name\s*=\s*["']?viewport\b/i.test(source);
 const hasTitle=/<title(?:\s[^>]*)?>[\s\S]{3,180}<\/title>/i.test(source);
 const productLinks=(combined.match(/href\s*=\s*["'][^"']*\/(?:produto|produtos|product|products|p)\/[^"']+["']/gi)||[]).length;
 const hasContacts=emails.length>0;
 const ownEmail=emails.some(e=>String(e).split('@')[1]===domain);
 const technical=[];
 if(source&&!hasViewport)technical.push('Meta viewport não encontrada na página inicial');
 if(source&&!hasTitle)technical.push('Título HTML não encontrado na página inicial');
 const scores={
  compatibility:{earned:0,max:30,verified:false,details:[]},
  improvement:{earned:0,max:25,verified:false,details:[]},
  contact:{earned:0,max:20,verified:false,details:[]},
  activity:{earned:0,max:15,verified:false,details:[]},
  approach:{earned:0,max:10,verified:false,details:[]}
 };
 const give=(id,n,msg)=>{const x=scores[id];x.earned+=n;x.verified=true;x.details.push(msg)};
 const seen=(id,msg)=>{scores[id].verified=true;scores[id].details.push(msg)};
 if(source){
  if(isStore)give('compatibility',12,'Estrutura de compra identificada na página pública');
  else seen('compatibility','Não foi possível confirmar o fluxo de compra');
  if(hasCatalog)give('compatibility',10,'Catálogo ou categorias identificados');
  else seen('compatibility','Catálogo não confirmado');
  if(platformKnown){
   if(blocked)seen('compatibility','Indícios de Nuvemshop; plataforma fora do foco');
   else give('compatibility',8,'Plataforma identificada: '+platform);
  } else scores.compatibility.details.push('Plataforma não identificada');
  scores.improvement.verified=true;
  if(!hasViewport)give('improvement',13,technical[0]);
  if(!hasTitle)give('improvement',12,'Título HTML não encontrado na página inicial');
  if(!technical.length)seen('improvement','Nenhum dos problemas técnicos simples avaliados foi detectado');
  if(isStore||hasCatalog)give('activity',9,'Conteúdo de loja ou catálogo encontrado no acesso atual');
  else seen('activity','Presença de catálogo não confirmada');
  if(productLinks>=2)give('activity',6,'Links para páginas de produtos identificados');
  else scores.activity.details.push('Atividade recente não confirmada');
 }
 if(hasContacts){
  give('contact',ownEmail?20:13,ownEmail?'E-mail público do domínio encontrado':'E-mail público encontrado, domínio diferente');
  give('approach',6,'Canal público para abordagem disponível');
 }else{
  scores.contact.details.push('E-mail não localizado; isso não comprova ausência de contato');
 }
 if(technical.length&&hasContacts)give('approach',4,'Problema técnico verificável para citar na abordagem');
 else scores.approach.details.push('Nenhuma melhoria específica confirmada para abordagem');
 const score=Object.values(scores).reduce((n,x)=>n+x.earned,0);
 const coverage=Object.values(scores).reduce((n,x)=>n+(x.verified?x.max:0),0);
 return {
   version:1,
   score:source&&coverage>=50?score:null,
   provisional:true,
   coverage,
   confidence:coverage>=85?'moderada':coverage>=50?'baixa':'insuficiente',
   criteria:scores,
   evidence:[...new Set(Object.values(scores).flatMap(x=>x.details).filter(x=>/identificad|encontrad|verific|não encontrad|fora do foco/i.test(x)))].slice(0,8),
   technical,
   status:source?'partial':'unavailable',
   note:source?'Score preliminar baseado em evidências técnicas; não avalia qualidade visual nem garante potencial de fechamento.':'Site não acessível pelo coletor; não é possível atribuir pontuação confiável.'
 };
}
