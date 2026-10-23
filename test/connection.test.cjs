const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { handler } = require('../netlify/functions/proxy');
const secret = 'test-secret-only';
const endpoint = 'https://script.google.com/macros/s/test-deployment/exec';
function bridge() {
  const source = Array(62).fill('');
  source[0] = '10/22/2026'; source[1] = 'Marc'; source[2] = 'Mall'; source[3] = 'Mattress Sale';
  source[4] = 'PRIVATE NAME'; source[6] = 'PRIVATE PHONE'; source[7] = 'PRIVATE EMAIL';
  source[12] = '$2,000'; source[47] = '2 pillows for PRIVATE CUSTOMER'; source[59] = 'PRIVATE NOTES';
  let reads = 0;
  const context = {
    PropertiesService: { getScriptProperties: () => ({getProperty: k => k === 'BCM_DASHBOARD_SECRET' ? secret : 'test-sheet'}) },
    Utilities: {computeHmacSha256Signature: (text,key) => [...createHmac('sha256',key).update(text).digest()]},
    ContentService: {MimeType: {JSON:'json'}, createTextOutput: text => ({setMimeType: () => JSON.parse(text)})},
    SpreadsheetApp: {openById: () => { reads++; return {getSheetByName: () => ({getLastRow:()=>2, getRange: (r,c,n) => ({getDisplayValue:()=>'Date', getDisplayValues:()=>[Array(62).fill('Date'),source]})})}; }},
  };
  vm.createContext(context); vm.runInContext(fs.readFileSync('google-apps-script/DashboardBridge.gs','utf8'),context);
  return {request: p=>context.doGet({parameter:p}), reads:()=>reads};
}
test('bridge denies unsigned, forged and expired requests before reading the sheet', () => {
  const b = bridge();
  for (const p of [{}, {timestamp:String(Date.now()),signature:'bad'}, {timestamp:String(Date.now()-600000),signature:'bad'}]) {
    assert.equal(b.request(p).error,'Unauthorized');
  }
  assert.equal(b.reads(),0);
});
test('bridge exports dashboard columns and strips customer details', () => {
  const b = bridge(); const timestamp=String(Date.now());
  const result = b.request({timestamp,signature:createHmac('sha256',secret).update(timestamp).digest('hex')});
  assert.equal(result.schemaVersion,1); assert.ok(result.csv.includes('$2,000')); assert.ok(result.csv.includes('pillow'));
  assert.ok(!result.csv.includes('PRIVATE')); assert.equal(b.reads(),1);
});
test('Netlify signs only the configured endpoint and hides credentials and upstream errors', async () => {
  process.env.BCM_SHEETS_BRIDGE_URL=endpoint; process.env.BCM_SHEETS_BRIDGE_SECRET=secret;
  const original=global.fetch;
  try {
    global.fetch = async url => {
      assert.equal(url.origin+url.pathname,endpoint);
      const ts=url.searchParams.get('timestamp');
      assert.equal(url.searchParams.get('signature'),createHmac('sha256',secret).update(ts).digest('hex'));
      return {ok:true,json:async()=>({schemaVersion:1,csv:'"Date","Rep"\r\n"10/22/2026","Marc"',updatedAt:new Date().toISOString()})};
    };
    const result=await handler({httpMethod:'GET',queryStringParameters:{url:'https://attacker.invalid'}});
    assert.equal(result.statusCode,200); assert.ok(!result.body.includes(secret));
    global.fetch=async()=>({ok:true,json:async()=>({error:'Unauthorized'})});
    assert.equal((await handler({httpMethod:'GET'})).statusCode,502);
    delete process.env.BCM_SHEETS_BRIDGE_SECRET;
    assert.equal((await handler({httpMethod:'GET'})).statusCode,503);
    assert.equal((await handler({httpMethod:'POST'})).statusCode,405);
  } finally {global.fetch=original;}
});
test('dashboard parser accepts the projected CSV and browser script parses', () => {
  const html=fs.readFileSync('index.html','utf8');
  const code=html.match(/<script>([\s\S]*)<\/script>/)[1];
  new vm.Script(code);
  const parser=code.slice(code.indexOf('function parseCSV('),code.indexOf('// ── INIT'));
  const b=bridge();const timestamp=String(Date.now());
  const csv=b.request({timestamp,signature:createHmac('sha256',secret).update(timestamp).digest('hex')}).csv;
  const context={};vm.createContext(context);vm.runInContext(parser,context);
  const records=context.parseCSV(csv);assert.equal(records.length,1);assert.equal(records[0].rr,2000);assert.equal(records[0].r,'Marc');
  assert.ok(!html.includes('corsproxy.io'));assert.ok(!html.includes('2PACX-'));
});
