import { ready,redisClient,REDIRECT,STORE,ADDRESS,seal,exchange,gmail } from '../../lib/gmail.js';

const go=(status)=>new Response(null,{status:302,headers:{Location:'/CRM/?gmail='+encodeURIComponent(status)+'#inbox','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export async function handler(request){
 if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const env=process.env;
 if(!ready(env))return go('setup');
 const url=new URL(request.url),state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
 if(!/^[a-zA-Z0-9_-]{40,64}$/.test(state)||!code||code.length>4096)return go('cancelled');
 const redis=redisClient(env);
 try{
   const present=await redis(['GETDEL','ricky:gmail:v1:state:'+state]);
   if(present!=='1')return go('invalid-state');
   const token=await exchange({code,grant_type:'authorization_code',redirect_uri:REDIRECT},env);
   if(!token.access_token||!token.refresh_token)return go('missing-refresh-token');
   const profile=await gmail('profile',token.access_token);
   if(String(profile.emailAddress||'').toLowerCase()!==ADDRESS)return go('wrong-account');
   await redis(['SET',STORE,seal({email:ADDRESS,refresh:token.refresh_token,scopes:token.scope||'',connectedAt:new Date().toISOString()},env)]);
   return go('connected');
 }catch{return go('failed')}
}

export default { fetch: handler };
