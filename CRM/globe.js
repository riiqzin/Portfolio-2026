/* Ricky CRM · lazy-loaded interactive canvas globe. No third-party library or tracking. */
(()=>{
'use strict';
const $=sel=>document.querySelector(sel);
const canvas=$('#countryGlobeCanvas'),modal=$('#countryGlobeModal'),country=$('#localCountry');
if(!canvas||!modal||!country)return;
const ctx=canvas.getContext('2d',{alpha:true});
if(!ctx){$('#globeFallback').hidden=false;canvas.hidden=true;return}
const places={
 BR:[-14.2,-51.9],IT:[42.6,12.5],PT:[39.5,-8.0],US:[38.8,-98.6],ES:[40.4,-3.7],FR:[46.6,2.2],
 DE:[51,10],GB:[54,-2.5],CH:[47,8.2],AT:[47.5,14],NL:[52.1,5.3],BE:[50.7,4.4],
 IE:[53.2,-8],CA:[56,-106],AR:[-35,-64],MX:[23,-102],CL:[-33,-71],UY:[-33,-56],JP:[37,138],AU:[-25,134],NZ:[-41,173]
};
const continents=[
 [[-168,71],[-142,69],[-131,58],[-125,49],[-124,39],[-117,32],[-112,28],[-105,23],[-97,16],[-90,16],[-84,10],[-77,9],[-79,20],[-82,25],[-81,31],[-72,45],[-66,50],[-59,54],[-78,61],[-98,72],[-125,72]],
 [[-82,12],[-73,10],[-62,11],[-51,4],[-45,-2],[-35,-8],[-38,-18],[-47,-25],[-50,-30],[-54,-34],[-65,-55],[-72,-46],[-74,-26],[-80,-5]],
 [[-13,36],[-10,44],[-7,55],[1,58],[10,55],[25,58],[31,70],[43,69],[58,61],[76,60],[88,55],[106,50],[121,42],[132,48],[145,46],[140,35],[124,28],[118,17],[107,11],[102,3],[97,5],[99,20],[90,22],[81,8],[76,8],[70,24],[60,25],[48,30],[44,41],[35,43],[30,40],[25,36],[12,36],[6,43],[-2,36]],
 [[-17,36],[-5,36],[12,33],[25,32],[35,29],[41,11],[51,11],[48,0],[41,-13],[33,-26],[21,-35],[12,-33],[9,-19],[2,-4],[-6,5],[-17,16]],
 [[113,-11],[115,-21],[130,-25],[139,-37],[152,-33],[154,-20],[141,-13],[126,-11]],
 [[166,-35],[175,-40],[179,-45],[171,-47]],
 [[-52,60],[-42,60],[-39,70],[-45,82],[-55,82],[-61,72]],
 [[-24,64],[-14,64],[-13,67],[-20,67]]
];
let lon=-35,lat=9,zoom=1,drag=null,raf=0,alive=true,points=[],hover=null,move=0,lastTick=0,lastFrame=0,dirty=true;
const rad=Math.PI/180;
function project(a,b,r){
 const phi=b*rad,lambda=(a-lon)*rad,center=lat*rad;
 const visible=Math.sin(center)*Math.sin(phi)+Math.cos(center)*Math.cos(phi)*Math.cos(lambda);
 return {x:Math.cos(phi)*Math.sin(lambda)*r,y:(Math.cos(center)*Math.sin(phi)-Math.sin(center)*Math.cos(phi)*Math.cos(lambda))*-r,z:visible};
}
function draw(t){
 if(!alive||modal.hidden){raf=0;return}
 if(t-lastFrame<32){raf=requestAnimationFrame(draw);return}lastFrame=t;
 const dpr=Math.min(2,window.devicePixelRatio||1),w=canvas.clientWidth||420,h=canvas.clientHeight||420;
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);dirty=true}
 if(!drag&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&t-lastTick<15000){lon=(lon+.019)%360;dirty=true}
 if(!drag&&lastTick&&t-lastTick>=15000)lastTick=t;
 if(dirty){
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const cx=w/2,cy=h/2,r=Math.min(w,h)*.37*zoom;
  ctx.save();
  ctx.shadowColor='rgba(80,231,197,.25)';ctx.shadowBlur=35;
  let g=ctx.createRadialGradient(cx-r*.4,cy-r*.52,r*.05,cx,cy,r*1.12);
  g.addColorStop(0,'#1d6a76');g.addColorStop(.38,'#113a53');g.addColorStop(.78,'#0a1b35');g.addColorStop(1,'#060d19');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
  // Subtle latitude and longitude grid projected onto a true orthographic sphere.
  ctx.strokeStyle='rgba(124,226,214,.12)';ctx.lineWidth=.7;
  const curve=(coords,fill=false)=>{
   let start=false;ctx.beginPath();
   for(const [a,b] of coords){const p=project(a,b,r);if(p.z>0){if(!start){ctx.moveTo(cx+p.x,cy+p.y);start=true}else ctx.lineTo(cx+p.x,cy+p.y)}else if(start){start=false}}
   if(fill){ctx.fill();ctx.stroke()}else ctx.stroke();
  };
  for(let la=-75;la<=75;la+=15){let coords=[];for(let lo=-180;lo<=180;lo+=2)coords.push([lo,la]);curve(coords)}
  for(let lo=-180;lo<180;lo+=20){let coords=[];for(let la=-90;la<=90;la+=2)coords.push([lo,la]);curve(coords)}
  for(const polygon of continents){
   // Densify edges to keep curved orthographic projection smooth.
   let coords=[];
   for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/3));for(let j=0;j<n;j++){const p=j/n;coords.push([a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p])}}
   ctx.fillStyle='rgba(35,161,145,.30)';ctx.strokeStyle='rgba(96,233,194,.42)';ctx.lineWidth=1.1;curve(coords,true);
  }
  const shine=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
  shine.addColorStop(0,'rgba(116,255,226,.13)');shine.addColorStop(.5,'transparent');shine.addColorStop(1,'rgba(1,8,20,.44)');
  ctx.fillStyle=shine;ctx.fillRect(cx-r,cy-r,r*2,r*2);
  ctx.restore();
  ctx.strokeStyle='rgba(121,244,217,.37)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
  points=[];
  const selected=country.value;
  for(const [code,[la,lo]] of Object.entries(places)){
   const p=project(lo,la,r);if(p.z<.06)continue;
   const x=cx+p.x,y=cy+p.y,active=selected===code;const radius=active?6.6:4.0;
   ctx.beginPath();ctx.arc(x,y,radius+4,0,Math.PI*2);ctx.fillStyle=active?'rgba(105,255,210,.18)':'rgba(85,202,217,.13)';ctx.fill();
   ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle=active?'#d8ffce':'#78e7d4';ctx.fill();points.push({code,x,y});
  }
  if(hover){const p=points.find(x=>x.code===hover);if(p){ctx.font='600 12px system-ui';const name=country.querySelector('option[value="'+p.code+'"]')?.textContent||p.code;const textWidth=ctx.measureText(name).width;const tx=Math.min(Math.max(p.x-textWidth/2-8,6),w-textWidth-24);ctx.fillStyle='rgba(7,18,31,.9)';ctx.fillRect(tx,p.y-32,textWidth+16,25);ctx.fillStyle='#d8fdec';ctx.fillText(name,tx+8,p.y-15)}}
  dirty=false;
 }
 raf=requestAnimationFrame(draw);
}
function start(){alive=true;lastTick=performance.now();dirty=true;if(!raf)raf=requestAnimationFrame(draw)}
function select(code){if(!places[code])return;country.value=code;country.dispatchEvent(new Event('change',{bubbles:true}));lat=places[code][0];lon=places[code][1];dirty=true;lastTick=performance.now()}
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,lon,lat};move=0;canvas.setPointerCapture(e.pointerId);lastTick=performance.now()});
canvas.addEventListener('pointermove',e=>{
 const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
 if(drag){move=Math.hypot(e.clientX-drag.x,e.clientY-drag.y);lon=drag.lon-(e.clientX-drag.x)*.38;lat=Math.max(-75,Math.min(75,drag.lat+(e.clientY-drag.y)*.30));dirty=true}
 else{const found=points.find(p=>Math.hypot(p.x-x,p.y-y)<13);const next=found?.code||null;if(next!==hover){hover=next;dirty=true}canvas.style.cursor=next?'pointer':'grab'}
});
canvas.addEventListener('pointerup',e=>{
 if(!drag)return;
 if(move<8){const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,found=points.find(p=>Math.hypot(p.x-x,p.y-y)<17);if(found)select(found.code)}
 drag=null;lastTick=performance.now();
});
canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.76,Math.min(1.22,zoom+(e.deltaY<0?.06:-.06)));dirty=true;lastTick=performance.now()},{passive:false});
$('#globeZoomIn')?.addEventListener('click',()=>{zoom=Math.min(1.22,zoom+.1);dirty=true});
$('#globeZoomOut')?.addEventListener('click',()=>{zoom=Math.max(.76,zoom-.1);dirty=true});
$('#globeReset')?.addEventListener('click',()=>select(country.value));
country.addEventListener('change',()=>{dirty=true});
window.addEventListener('resize',()=>{dirty=true});
window.RickyGlobe={open:start,focus:select,close:()=>{alive=false;cancelAnimationFrame(raf);raf=0}};
start();
})();