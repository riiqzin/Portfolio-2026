import { createHash } from 'node:crypto';
import { authorized, json, configured, redisClient, boundedText } from './radar-control.js';

const MODELS=Object.freeze({
 'gpt-5.4-mini':{input:0.75,cached:0.075,output:4.5,reservationCents:4},
 'gpt-5.4':{input:2.5,cached:0.25,output:15,reservationCents:8}
});
const BUDGET_CENTS=50;
const BUDGET_KEY='ricky:lab:reserved-cents:v1';
const SPEND_KEY='ricky:lab:estimated-microusd:v1';
const companySpendKey=id=>'ricky:lab:estimated-microusd:v1:'+id;
const recordKey=id=>'ricky:onboarding:v1:'+id;
const promptKey=id=>'ricky:onboarding:prompt:v1:'+id;
const fingerprint=form=>createHash('sha256').update(JSON.stringify([form.company,form.segment,form.submittedAt,form.answers])).digest('hex');
const acceptedId=id=>typeof id==='string'&&/^[0-9a-f]{64}$/.test(id);
const text=v=>typeof v==='string'?v.trim():'';
const limitText=(s,n)=>text(s).slice(0,n);
const reservationLua=`local c=tonumber(redis.call('GET',KEYS[1]) or '0')
if c+tonumber(ARGV[1])>tonumber(ARGV[2]) then return {0,c} end
return {1,redis.call('INCRBY',KEYS[1],ARGV[1])}`;

function reading(usage,prices){
 const input=Math.max(0,Number(usage?.input_tokens)||0),output=Math.max(0,Number(usage?.output_tokens)||0);
 const cached=Math.max(0,Math.min(input,Number(usage?.input_tokens_details?.cached_tokens)||0));
 const usd=((input-cached)*prices.input+cached*prices.cached+output*prices.output)/1e6;
 return {inputTokens:input,cachedTokens:cached,outputTokens:output,estimatedUsd:Number(usd.toFixed(6))};
}
function officialCompanyData(business){
 const a=business.answers||{};
 const safe=value=>String(value??'').replace(/[<>]/g,char=>char==='<'?'‹':'›').trim();
 const lines=['Nome: '+safe(business.company),'Segmento: '+safe(business.segment),'Serviços e preços: '+safe(a.services),'Horário de funcionamento: '+safe(a.hours),'Formas de pagamento: '+safe(Array.isArray(a.payments)?a.payments.join(', '):a.payments)];
 for(const [label,key] of [['Endereço','address'],['Contato para atendimento humano','humanContact'],['Site ou catálogo','link'],['Políticas e informações importantes','policy'],['Observações','notes']])if(safe(a[key]))lines.push(label+': '+safe(a[key]));
 return '<dados_empresa>\n'+lines.join('\n')+'\n</dados_empresa>';
}
function executionPrompt(reviewed,business,clock){
 const raw=reviewed.text;
 const modules=['modulo_atendimento_humano','modulo_agendamento'];
 let out=raw;
 // The verified form, not the AI-generated text, supplies definitive company facts.
 const companyBlock=new RegExp('<dados_empresa>[\\s\\S]*?<\\/dados_empresa>');
 if(!companyBlock.test(out))throw new Error('missing_company_data');
 out=out.replace(companyBlock,()=>officialCompanyData(business));
 // The laboratory deliberately exposes neither handoff nor booking tools.
 for(const name of modules){
  const re=new RegExp('<'+name+'>[\\s\\S]*?<\\/'+name+'>','g');
  out=out.replace(re,'');
 }
 const time=new Intl.DateTimeFormat('pt-BR',{dateStyle:'full',timeStyle:'long',timeZone:'America/Sao_Paulo'}).format(clock());
 const context=/\<contexto_da_conversa\>[\s\S]*?\<\/contexto_da_conversa\>/;
 if(!context.test(out))throw new Error('missing_context');
 out=out.replace(context,'<contexto_da_conversa>\nData e hora atuais: '+time+' | Fuso: America/Sao_Paulo\n</contexto_da_conversa>');
 return out+'\nREGRAS DE EXECUÇÃO DO SERVIDOR: Nenhuma ferramenta está disponível neste laboratório. Não agende, não confirme pagamentos nem afirme que avisou alguém. Se pedirem humano, informe o contato somente se constar nos dados da empresa. Sem dados, indique que não pode avisar a equipe agora. Datas e horários especiais ou feriados são desconhecidos salvo indicação explícita. REGRA PRIORITÁRIA DE RESPOSTA: seja direto, normalmente uma única frase. Responda somente ao que perguntaram; não acrescente oferta de serviços, preços, endereço, horários, nem encerre com se quiser posso, posso te passar ou perguntas automáticas. Só pergunte quando precisar de informação essencial. SEM consultar_horarios, NÃO ofereça ou sugira horário ou data para agendar; o expediente não representa disponibilidade. Formatação WhatsApp: sem Markdown duplo; use apenas *um asterisco* para negrito, ou nenhum.';
}
const whatsappText=value=>value.replace(/\*\*([^*\n]+)\*\*/g,'*$1*').trim();
const responseText=p=>Array.isArray(p?.output)?p.output.flatMap(o=>Array.isArray(o?.content)?o.content:[]).filter(o=>o.type==='output_text').map(o=>o.text||'').join('\n').trim():'';
export function createHandler({env=process.env,fetcher=fetch,clock=()=>new Date()}={}){
 return async request=>{
  if(!authorized(request,env))return json({message:'Não autorizado.'},401);
  if(!configured(env))return json({message:'Controle de custos indisponível.'},503);
  const redis=redisClient(env,fetcher);
  if(request.method==='GET'){
   try{
    const companyId=new URL(request.url).searchParams.get('id');
    const [amount,estimate,companyEstimate]=await Promise.all([redis(['GET',BUDGET_KEY]),redis(['GET',SPEND_KEY]),acceptedId(companyId)?redis(['GET',companySpendKey(companyId)]):Promise.resolve(null)]);
    const reservedCents=Number(amount)||0,estimatedMicrousd=Number(estimate)||0;
    return json({enabled:env.RICKY_LAB_PAID_ENABLED==='true'&&!!env.OPENAI_API_KEY,
      models:Object.keys(MODELS),reservedCents,budgetCents:BUDGET_CENTS,estimatedUsd:estimatedMicrousd/1e6,companyEstimatedUsd:(Number(companyEstimate)||0)/1e6,estimatedSince:'Contagem acumulada somente após ativação desta medição',
      warning:'Reservas internas não são fatura oficial. Testes somente após habilitação e confirmação.'});
   }catch{return json({message:'Orçamento indisponível.'},503)}
  }
  if(request.method!=='POST')return json({message:'Método não permitido.'},405);
  if(env.RICKY_LAB_PAID_ENABLED!=='true'||!env.OPENAI_API_KEY)return json({message:'Testes reais desativados. Nenhum crédito foi usado. Ative explicitamente no servidor quando decidir testar.'},403);
  let body;try{body=JSON.parse(await boundedText(request,7000))}catch{return json({message:'Dados inválidos.'},400)}
  if(body?.confirmPaid!==true)return json({message:'Confirme o teste pago antes de enviar.'},400);
  const {id,model}=body;
  if(!acceptedId(id)||!Object.hasOwn(MODELS,model))return json({message:'Empresa ou modelo inválido.'},400);
  const message=limitText(body.message,400);
  if(message.length<2)return json({message:'Escreva uma pergunta.'},400);
  const messages=Array.isArray(body.history)?body.history.slice(-8):[];
  if(messages.some(x=>!['user','assistant'].includes(x?.role)||typeof x?.content!=='string'||x.content.length>450))return json({message:'Histórico inválido.'},400);
  const history=messages.map(x=>({role:x.role,content:x.content}));
  try{
   const raw=await redis(['GET',recordKey(id)]);
   if(!raw)return json({message:'Formulário não encontrado.'},404);
   const business=JSON.parse(raw);
   if(business.status!=='recebido'||!business.answers)return json({message:'Empresa ainda não respondeu o formulário.'},409);
   const promptRaw=await redis(['GET',promptKey(id)]);
   if(!promptRaw)return json({message:'Salve primeiro o prompt personalizado desta empresa. Nenhuma chamada à OpenAI foi feita.'},409);
   const reviewed=JSON.parse(promptRaw);
   if(reviewed.fingerprint!==fingerprint(business))return json({message:'Prompt desatualizado: revise as respostas da empresa e salve outra versão.'},409);
   if(typeof reviewed.text!=='string'||reviewed.text.length<350||reviewed.text.length>16000)return json({message:'O prompt salvo é inválido. Revise antes de testar.'},409);
   if(!['regras_fixas','dados_empresa','modulo_atendimento_humano','modulo_agendamento','contexto_da_conversa'].every(t=>reviewed.text.includes('<'+t+'>')&&reviewed.text.includes('</'+t+'>')))return json({message:'Prompt antigo ou incompleto. Gere e salve o novo modelo modular antes de testar.'},409);
   const system=executionPrompt(reviewed,business,clock);
   const input=[...history,{role:'user',content:message}];
   const total=system.length+input.reduce((n,x)=>n+x.content.length,0);
   if(total>18000)return json({message:'Conversa longa demais para este teste. Limpe o histórico.'},413);
   const price=MODELS[model],reserved=await redis(['EVAL',reservationLua,1,BUDGET_KEY,price.reservationCents,BUDGET_CENTS]);
   if(!Array.isArray(reserved)||reserved[0]!==1)return json({message:'Limite de testes atingido. Nenhuma chamada enviada à OpenAI.'},429);
   // Reservations deliberately are not refunded: a timed-out request may still be billed.
   let result;
   try{
    const r=await fetcher('https://api.openai.com/v1/responses',{
     method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
     headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
     body:JSON.stringify({model,store:false,instructions:system,input,max_output_tokens:400,reasoning:{effort:'none'}})
    });
    if(!r.ok)return json({message:'A OpenAI não concluiu o teste. A reserva de segurança continua contabilizada.'},502);
    result=await r.json();
   }catch{return json({message:'Não foi possível confirmar a resposta. Confira os gastos oficiais antes de repetir.'},502)}
   const answer=whatsappText(responseText(result));
   if(!answer)return json({message:'O modelo não retornou texto. Confira o uso oficial da OpenAI.'},502);
   const usage=reading(result.usage,price);
   const estimatedMicrousd=Math.round(usage.estimatedUsd*1e6);
   // Accounting is an estimate, not OpenAI's invoice; failed writes do not invalidate a successful response.
   if(estimatedMicrousd>0){
    try{await redis(['INCRBY',SPEND_KEY,estimatedMicrousd]);await redis(['INCRBY',companySpendKey(id),estimatedMicrousd])}catch{}
   }
   return json({answer,model,usage,reservedCents:Number(reserved[1]),budgetCents:BUDGET_CENTS});
  }catch{return json({message:'Não foi possível concluir o teste; nenhuma chamada adicional foi iniciada automaticamente.'},503)}
 };
}
export default {fetch:createHandler()};
