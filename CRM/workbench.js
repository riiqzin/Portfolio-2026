/* Presentation only: interrupted animations cancel, all data stays in existing controllers. */
(()=>{
 'use strict';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const running=new Set();
 document.querySelectorAll('[data-scroll-target]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();document.getElementById(link.dataset.scrollTarget)?.scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'})}));
 function move(node,frames,options){
  if(reduced.matches||!node||document.hidden)return;
  node.getAnimations().forEach(animation=>animation.cancel());
  const animation=node.animate(frames,options);running.add(animation);
  animation.finished.catch(()=>{}).finally(()=>running.delete(animation));
 }
 reduced.addEventListener('change',()=>{if(reduced.matches){document.getAnimations().forEach(animation=>animation.cancel());running.clear()}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)running.forEach(animation=>animation.cancel())});
 // Navigation has a short shutter reveal, without delaying navigation or moving controls.
 document.querySelectorAll('.page').forEach(page=>{
  new MutationObserver(()=>{
   if(!page.hidden)move(page,[{clipPath:'inset(0 0 100% 0)'},{clipPath:'inset(0 0 0 0)'}],{duration:240,easing:'cubic-bezier(.22,.8,.3,1)'});
  }).observe(page,{attributes:true,attributeFilter:['hidden']});
 });
 // Values keep their exact text. A short mechanical tick marks a real update.
 document.querySelectorAll('.stat strong,.costs-hero strong').forEach(node=>{
  let previous=node.textContent;
  new MutationObserver(()=>{
   if(previous===node.textContent)return;previous=node.textContent;
   move(node,[{transform:'translateY(3px)',color:'#e4bf73'},{transform:'translateY(0)',color:getComputedStyle(node).color}],{duration:280,easing:'ease-out'});
  }).observe(node,{childList:true,characterData:true,subtree:true});
 });
 // Keep horizontal pipeline position across filtering and data refreshes.
 const board=document.querySelector('#clientList');
 if(board){
  let left=0;board.addEventListener('scroll',()=>{left=board.scrollLeft},{passive:true});
  new MutationObserver(()=>{if(board.classList.contains('pipeline-board'))board.scrollLeft=left}).observe(board,{childList:true});
 }
 // Modal keyboard containment and focus restoration; handlers remain in local.js.
 document.querySelectorAll('.overlay,.globe-modal').forEach(modal=>{
  let previousFocus=null;
  const focusable=()=>[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(node=>node.getClientRects().length);
  const focusIn=()=>{previousFocus=document.activeElement;focusable()[0]?.focus({preventScroll:true})};
  new MutationObserver(()=>{
   if(!modal.hidden){focusIn();move(modal.firstElementChild,[{transform:'scale(.985)',opacity:.5},{transform:'scale(1)',opacity:1}],{duration:180,easing:'ease-out'});}
   else if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
  }).observe(modal,{attributes:true,attributeFilter:['hidden']});
  modal.addEventListener('keydown',event=>{
   if(event.key!=='Tab')return;const items=focusable();if(!items.length)return;
   if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items.at(-1).focus()}
   else if(!event.shiftKey&&document.activeElement===items.at(-1)){event.preventDefault();items[0].focus()}
  });
  if(!modal.hidden)focusIn();
 });
})();
