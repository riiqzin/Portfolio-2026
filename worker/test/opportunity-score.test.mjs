import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOpportunity} from '../../lib/opportunity-score.js';

test('full evidence scores by declared five weights, without inventing aesthetic issues',()=>{
 const result=evaluateOpportunity({
  domain:'lojaexemplo.com.br',
  html:'<html><head><title>Loja Exemplo</title><meta name="viewport" content="width=device-width"></head><body><a href="/produto/item-1">Produto</a><a href="/produto/item-2">Produto</a><button>Adicionar ao carrinho</button><h2>Catálogo</h2></body></html>',
  emails:['contato@lojaexemplo.com.br'],
  platform:'WooCommerce (indício técnico)'
 });
 assert.equal(result.score,71);
 assert.equal(result.coverage,100);
 assert.equal(result.criteria.improvement.earned,0);
 assert.deepEqual(result.technical,[]);
 assert.equal(Object.values(result.criteria).reduce((n,c)=>n+c.max,0),100);
});
test('blocked store cannot get a made-up score or a fabricated contact',()=>{
 const result=evaluateOpportunity({domain:'lojaexemplo.com.br'});
 assert.equal(result.score,null);
 assert.equal(result.status,'unavailable');
 assert.equal(result.confidence,'insuficiente');
 assert.equal(result.criteria.contact.verified,false);
});
test('missing viewport and title produce narrow reproducible findings, not aesthetic judgements',()=>{
 const result=evaluateOpportunity({
  domain:'lojaexemplo.com.br',
  html:'<html><body><h2>Catálogo de produtos</h2><a href="/produto/x">Comprar agora</a></body></html>'
 });
 assert.equal(result.criteria.improvement.earned,25);
 assert.ok(result.technical.some(x=>x.includes('viewport')));
 assert.ok(!result.evidence.some(x=>/feio|desatualizado|lento|checkout ruim/i.test(x)));
});
