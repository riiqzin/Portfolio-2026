import { sendDue } from './outreach.js';
import { ready,redisClient,syncInbox } from '../lib/gmail.js';
import { json } from '../lib/radar-control.js';

export async function handler(request){
 if(request.method!=='GET')return json({message:'Método não permitido.'},405);
 const env=process.env;
 if(!env.CRON_SECRET || request.headers.get('authorization')!==('Bearer '+env.CRON_SECRET))return json({message:'Não autorizado.'},401);
 if(!ready(env))return json({message:'Integração Gmail não configurada.'},503);
 try {
   const scheduled=await sendDue({env});
   try{
     const result=await syncInbox(env,redisClient(env));
     return json({ok:true,checked:result.count||0,busy:!!result.busy,scheduled});
   }catch{return json({ok:true,checked:0,inboxSyncPending:true,scheduled})}
 }catch{return json({ok:false,message:'Sincronização adiada; reconecte o Gmail se a autorização expirou.'},503)}
}
export default { fetch:handler };
