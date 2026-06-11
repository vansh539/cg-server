const http = require('http');
const xml2js = require('xml2js');

const xp = new xml2js.Parser({explicitArray:false, ignoreAttrs:false, trim:true, valueProcessors:[xml2js.processors.stripPrefix]});
const px = xml => xp.parseStringPromise(xml).catch(e => { console.log('Parse error:', e.message); return null; });
const tMsg = res => res?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE || res?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE;
const arr = v => !v ? [] : (Array.isArray(v) ? v : [v]);

function post(xml) {
  return new Promise((ok, fail) => {
    const req = http.request(
      { hostname: 'localhost', port: 9000, method: 'POST',
        headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => ok(d)); }
    );
    req.on('error', fail);
    req.setTimeout(90000, () => req.destroy(new Error('timeout')));
    req.write(xml); req.end();
  });
}

const COMPANY = 'VANSH IRON (26-27)';

(async () => {
  // Test 1: List of Accounts — parse with xml2js and trace the path
  console.log('=== Test 1: List of Accounts (xml2js parse) ===');
  const rawAccts = await post(
    `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`
  );
  console.log('Raw length:', rawAccts.length);
  console.log('Parsing with xml2js (may take a few seconds for large XML)...');
  const res1 = await px(rawAccts);
  if (!res1) { console.log('PARSE FAILED — null returned'); }
  else {
    const bodyKeys = Object.keys(res1?.ENVELOPE?.BODY || {});
    console.log('ENVELOPE.BODY keys:', bodyKeys);
    const msg = tMsg(res1);
    console.log('tMsg() found:', !!msg);
    if (msg) {
      console.log('TALLYMESSAGE keys:', Object.keys(msg));
      const ledgers = arr(msg.LEDGER);
      console.log('LEDGER count:', ledgers.length);
      if (ledgers.length > 0) {
        console.log('First ledger sample:', JSON.stringify(ledgers[0]).slice(0, 300));
      }
    } else {
      // Try to trace where the path breaks
      console.log('IMPORTDATA exists:', !!res1?.ENVELOPE?.BODY?.IMPORTDATA);
      const imp = res1?.ENVELOPE?.BODY?.IMPORTDATA;
      if (imp) {
        console.log('IMPORTDATA keys:', Object.keys(imp));
        if (imp.REQUESTDATA) {
          console.log('REQUESTDATA keys:', Object.keys(imp.REQUESTDATA));
          if (imp.REQUESTDATA.TALLYMESSAGE) {
            console.log('TALLYMESSAGE keys:', Object.keys(imp.REQUESTDATA.TALLYMESSAGE));
          }
        }
      }
    }
  }

  // Test 2: Day Book — parse and check vouchers
  console.log('\n=== Test 2: Day Book (xml2js parse) ===');
  const today = new Date();
  const from = new Date(today); from.setDate(from.getDate() - 30);
  const fmt = d => `${d.getDate()}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}-${d.getFullYear()}`;
  const rawDB = await post(
    `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY><SVFROMDATE>${fmt(from)}</SVFROMDATE><SVTODATE>${fmt(today)}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`
  );
  console.log('Raw length:', rawDB.length);
  const res2 = await px(rawDB);
  if (!res2) { console.log('PARSE FAILED'); }
  else {
    const bodyKeys = Object.keys(res2?.ENVELOPE?.BODY || {});
    console.log('ENVELOPE.BODY keys:', bodyKeys);
    const msg = tMsg(res2);
    console.log('tMsg() found:', !!msg);
    if (msg) {
      console.log('TALLYMESSAGE keys:', Object.keys(msg));
      const vs = arr(msg.VOUCHER);
      console.log('VOUCHER count:', vs.length);
      if (vs.length > 0) console.log('First voucher sample:', JSON.stringify(vs[0]).slice(0, 300));
    } else {
      const imp = res2?.ENVELOPE?.BODY?.IMPORTDATA;
      if (imp) {
        console.log('IMPORTDATA keys:', Object.keys(imp));
        if (imp.REQUESTDATA) console.log('REQUESTDATA keys:', Object.keys(imp.REQUESTDATA));
      }
    }
  }
})().catch(console.error);
