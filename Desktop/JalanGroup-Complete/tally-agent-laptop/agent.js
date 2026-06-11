/**
 * Jalan Group — Tally Sync Agent v2.4.3
 * Fixes: sequential requests, limited date range, gentle sync intervals,
 * working hours guard, command polling for on-demand ledger PDF.
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const axios   = require('axios');
const xml2js  = require('xml2js');
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const os      = require('os');

const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) { console.error('config.json not found'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const {
  server_url, api_key, company_code, tally_company,
  tally_port = 9000,
  sync_interval_min = 60,
  check_interval_sec = 60,
  voucher_days = 90,
} = cfg;

// Support multiple Tally year-companies merging under one company_code.
// In config.json, set either:
//   "tally_company": "Vansh Iron 2024-25"          (single, legacy)
//   "tally_companies": ["Vansh Iron 2023-24", "Vansh Iron 2024-25"]  (multi-year)
const TALLY_COMPANIES = cfg.tally_companies
  ? (Array.isArray(cfg.tally_companies) ? cfg.tally_companies : [cfg.tally_companies])
  : [tally_company];

// Active company during sync loop (switches per iteration when multi-year)
let currentTallyCompany = TALLY_COMPANIES[0];

const TALLY_URL  = `http://localhost:${tally_port}`;
const PUSH_URL   = `${server_url.replace(/\/$/, '')}/agent/push`;
const CMD_URL    = `${server_url.replace(/\/$/, '')}/agent/commands`;
const LOG_FILE   = path.join(__dirname, 'agent.log');
const VERSION    = '2.4.3';
const HOSTNAME   = os.hostname();

const WORK_START = 0;
const WORK_END   = 0;

function isWorkingHours() {
  const h = new Date().getHours();
  return h >= WORK_START && h < WORK_END;
}

function log(msg, lvl = 'INFO') {
  const line = `[${new Date().toLocaleString('en-IN',{hour12:false})}] [${lvl}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    if (fs.statSync(LOG_FILE).size > 2*1024*1024) {
      const lines = fs.readFileSync(LOG_FILE,'utf8').split('\n');
      fs.writeFileSync(LOG_FILE, lines.slice(-1000).join('\n'));
    }
  } catch {}
}

let tallyWasOpen = false, lastSyncAt = null, syncing = false, fails = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isTallyRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq tally.exe" /FO CSV /NH 2>nul', { encoding:'utf8', timeout:5000, windowsHide:true });
    if (out.toLowerCase().includes('tally.exe')) return true;
    const out2 = execSync('tasklist /FI "IMAGENAME eq tallyprime.exe" /FO CSV /NH 2>nul', { encoding:'utf8', timeout:5000, windowsHide:true });
    return out2.toLowerCase().includes('tallyprime.exe');
  } catch { return false; }
}

async function isTallyHTTPReady() {
  try { await axios.get(TALLY_URL, {timeout:4000}).catch(()=>{}); return true; }
  catch { return false; }
}

const xp  = new xml2js.Parser({explicitArray:false,ignoreAttrs:false,trim:true,valueProcessors:[xml2js.processors.stripPrefix]});
const px  = xml => xp.parseStringPromise(xml).catch(()=>null);
// TallyPrime sends one <TALLYMESSAGE> per master → xml2js parses as array with numeric keys.
// ERP 9 sends one <TALLYMESSAGE> with typed arrays inside.
// extract() handles both.
const extract = (res, type) => {
  const raw = res?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE ||
              res?.ENVELOPE?.BODY?.IMPORTDATA?.REQUESTDATA?.TALLYMESSAGE;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap(m => arr(m?.[type] || [])); // TallyPrime
  return arr(raw[type] || []);  // ERP 9
};
const arr = v => !v?[]:(Array.isArray(v)?v:[v]);
const v   = n => { if(!n)return null; if(typeof n==='string')return n.trim()||null; if(n&&n._)return n._.trim()||null; return null; };
const num = s => { const n=parseFloat(String(s||'').replace(/[^0-9.\-]/g,'')); return isNaN(n)?0:Math.abs(n); };
const dt  = s => { if(!s)return null; if(/^\d{8}$/.test(String(s))){ const d=String(s); return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`; } const d=new Date(s); return isNaN(d.getTime())?null:d.toISOString().split('T')[0]; };
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const td  = d => `${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
const fys = () => { const n=new Date(),y=n.getMonth()>=3?n.getFullYear():n.getFullYear()-1; return td(new Date(y,3,1)); };
const ago = n => { const d=new Date(); d.setDate(d.getDate()-n); return td(d); };
const DGRP=['sundry debtor','trade debtor','customer'];
const CGRP=['sundry creditor','trade creditor','supplier'];
const PGRP=[...DGRP,...CGRP];
const isP  = g => g&&PGRP.some(p=>g.toLowerCase().includes(p));
const isDr = g => g&&DGRP.some(p=>g.toLowerCase().includes(p));
const SYS  =['sales','purchase','igst','cgst','sgst','gst','cash','bank','duties','taxes'];
const isSys= n => n&&SYS.some(s=>n.toLowerCase().includes(s));
const mob  = r => { const d=String(r||'').replace(/\D/g,''); if(d.startsWith('91')&&d.length===12)return d.slice(2); return d.length===10?d:null; };

async function tPost(body, timeoutMs = 45000) {
  const r = await axios.post(TALLY_URL, body, {
    headers:{'Content-Type':'application/xml'},
    timeout: timeoutMs,
    responseType:'text'
  });
  return r.data;
}

async function fetchLedgers() {
  log('  Fetching ledgers (List of Accounts — TallyPrime)...');
  const raw = await tPost(`<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${currentTallyCompany}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`, 90000);
  const res  = await px(raw);
  const leds = extract(res, 'LEDGER');
  return leds.filter(l => {
    const name = v(l.NAME) || v(l?.$?.NAME);
    const parent = v(l.PARENT);
    return name && isP(parent);
  }).map(l => ({
    name: v(l.NAME) || v(l?.$?.NAME) || '',
    party_type: isDr(v(l.PARENT)) ? 'customer' : 'supplier',
    mobile: mob(v(l.MOBILENO)||v(l.LEDGERMOBILE)||v(l.LEDGERPHONE)||v(l.PHONENUMBER)||v(l.PHONE)||v(l['MOBILE.LIST']?.MOBILE)||''),
    email: v(l.EMAIL) || v(l.EMAILID) || null,
    gstin: (v(l.GSTREGISTRATIONNUMBER)||v(l.GSTIN)||v(l.PARTYGSTIN)||'').toUpperCase()||null,
    address: v(l.ADDRESS)||v(l['ADDRESS.LIST']?.ADDRESS)||v(l.MAILINGNAME)||null,
    state: v(l.STATENAME)||v(l.LEDGERSTATENAME)||v(l.STATE)||null,
    credit_limit: num(v(l.CREDITLIMIT)), closing_bal: num(v(l.CLOSINGBALANCE)),
    bal_type: v(l.CLOSINGBALANCETYPE)||'Dr',
  }));
}

async function fetchOutstanding() {
  log('  Fetching outstanding...');
  const raw = await tPost(`<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Outstanding Receivables</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${currentTallyCompany}</SVCURRENTCOMPANY><SVFROMDATE>20190401</SVFROMDATE><SVTODATE>$$TodaysDate</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`);
  const res = await px(raw);
  const bs  = arr(res?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE?.BILLALLOCATIONS?.BILLALLOCATION||[]);
  return bs.map(b=>({ledger_name:v(b.LEDGERNAME)||v(b?.$?.LEDGERNAME)||'',bill_no:v(b.BILLNO)||v(b?.$?.NAME)||'',amount:num(v(b.CLOSINGBALANCE)||v(b.AMOUNT)),bill_date:dt(v(b.BILLDATE)||v(b.DATE)),due_date:dt(v(b.DUEDATE))})).filter(b=>b.amount>0&&b.ledger_name);
}

async function fetchVouchers() {
  const fromDate = ago(voucher_days);
  log(`  Fetching vouchers (last ${voucher_days} days from ${fromDate})...`);
  const raw = await tPost(`<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${currentTallyCompany}</SVCURRENTCOMPANY><SVFROMDATE>${fromDate}</SVFROMDATE><SVTODATE>${td(new Date())}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`, 60000);
  const res = await px(raw);
  const vs  = extract(res, 'VOUCHER');
  return vs.filter(vv=>v(vv.VOUCHERNUMBER)&&v(vv.DATE)).map(vv=>{
    const ents=arr(vv.ALLLEDGERENTRIES?.ALLLEDGERENTRY||[]);
    const party=ents.find(e=>!isSys(v(e.LEDGERNAME)));
    return {voucher_no:v(vv.VOUCHERNUMBER),voucher_type:v(vv.VOUCHERTYPENAME),date:dt(v(vv.DATE)),party_name:v(party?.LEDGERNAME)||null,amount:num(v(vv.AMOUNT)),narration:v(vv.NARRATION)||null};
  }).filter(vv=>vv.voucher_no&&vv.date);
}

async function fetchPayables() {
  log('  Fetching payables...');
  const raw = await tPost(`<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Outstanding Payables</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${currentTallyCompany}</SVCURRENTCOMPANY><SVFROMDATE>20190401</SVFROMDATE><SVTODATE>$$TodaysDate</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`);
  const res = await px(raw);
  const bs  = arr(res?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE?.BILLALLOCATIONS?.BILLALLOCATION||[]);
  return bs.map(b=>({ledger_name:v(b.LEDGERNAME)||v(b?.$?.LEDGERNAME)||'',bill_no:v(b.BILLNO)||v(b?.$?.NAME)||'',amount:num(v(b.CLOSINGBALANCE)||v(b.AMOUNT)),bill_date:dt(v(b.BILLDATE)||v(b.DATE)),due_date:dt(v(b.DUEDATE)),type:'payable'})).filter(b=>b.amount>0&&b.ledger_name);
}

async function fetchStock() {
  log('  Fetching stock...');
  const raw = await tPost(`<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Stock Summary</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${currentTallyCompany}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`);
  const res = await px(raw);
  const items=extract(res, 'STOCKITEM');
  return items.filter(i=>i?.$?.NAME).map(i=>({tally_name:i.$.NAME,qty:num(v(i.CLOSINGBALANCE)),unit:v(i.BASEUNITS)||'MT',rate:num(v(i.CLOSINGRATE))}));
}

async function fetchPartyLedger(ledgerName, days) {
  const toDate   = td(new Date());
  const fromDate = ago(days || voucher_days);
  log(`  Fetching party ledger: ${ledgerName} (${fromDate} to ${toDate})`);
  const raw = await tPost(`<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${currentTallyCompany}</SVCURRENTCOMPANY><SVFROMDATE>${fromDate}</SVFROMDATE><SVTODATE>${toDate}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`, 90000);
  const res = await px(raw);
  const allVouchers = extract(res, 'VOUCHER');
  log(`  Day Book total vouchers: ${allVouchers.length}`);
  const ledgerLower = ledgerName.toLowerCase().trim();
  const partyVouchers = allVouchers.filter(vv => {
    const entries = arr(vv.ALLLEDGERENTRIES?.ALLLEDGERENTRY || []);
    return entries.some(e => (v(e.LEDGERNAME) || '').toLowerCase().trim() === ledgerLower);
  });
  log(`  Filtered to ${partyVouchers.length} vouchers for ${ledgerName}`);
  return partyVouchers.map(vv => {
    const vtype = (v(vv.VOUCHERTYPENAME) || '').toLowerCase();
    const entries = arr(vv.ALLLEDGERENTRIES?.ALLLEDGERENTRY || []);
    const partyEntry = entries.find(e => (v(e.LEDGERNAME) || '').toLowerCase().trim() === ledgerLower);
    const rawAmount = partyEntry ? parseFloat(String(v(partyEntry.AMOUNT) || '0').replace(/[^0-9.\-]/g, '')) : 0;
    const absAmount = Math.abs(rawAmount) || num(v(vv.AMOUNT));
    const isDebitType  = vtype.includes('sales') || vtype.includes('debit note');
    const isCreditType = vtype.includes('receipt') || vtype.includes('payment') || vtype.includes('purchase') || vtype.includes('credit note') || vtype.includes('journal');
    return {
      date:          dt(v(vv.DATE)),
      voucher_no:    v(vv.VOUCHERNUMBER),
      voucher_type:  v(vv.VOUCHERTYPENAME),
      narration:     v(vv.NARRATION),
      debit_amount:  isDebitType  ? absAmount : 0,
      credit_amount: isCreditType ? absAmount : 0,
    };
  }).filter(e => e.date && e.voucher_no);
}

async function pushToServer(payload) {
  const r = await axios.post(PUSH_URL, payload, {
    headers:{'Content-Type':'application/json','X-Agent-Key':api_key,'X-Company-Code':company_code,'X-Agent-Version':VERSION,'X-Hostname':HOSTNAME},
    timeout:90000
  });
  return r.data;
}

async function sendHeartbeat(open) {
  try {
    await axios.post(`${server_url.replace(/\/$/,'')}/agent/heartbeat`,
      {company_code,tally_open:open,hostname:HOSTNAME,agent_version:VERSION,tally_company,last_sync_at:lastSyncAt?.toISOString()||null},
      {headers:{'X-Agent-Key':api_key,'X-Company-Code':company_code},timeout:8000}
    );
  } catch {}
}

async function doSync(reason) {
  if (syncing) return;
  syncing = true;
  log(`Sync start — ${reason} (${TALLY_COMPANIES.length} Tally compan${TALLY_COMPANIES.length > 1 ? 'ies' : 'y'})`);
  try {
    // Merge data from all year-companies
    let allLedgers = [], allBills = [], allPayables = [], allStock = [], allVouchers = [];

    for (const tallyComp of TALLY_COMPANIES) {
      log(`  → Syncing: ${tallyComp}`);
      // Temporarily override tally_company in all fetch functions via a module-level var
      currentTallyCompany = tallyComp;

      const ledgers  = await fetchLedgers().catch(e  => { log(`  ledgers failed (${tallyComp}): ${e.message}`, 'WARN'); return []; });
      await sleep(2000);
      const bills    = await fetchOutstanding().catch(e => { log(`  outstanding failed (${tallyComp}): ${e.message}`, 'WARN'); return []; });
      await sleep(2000);
      const payables = await fetchPayables().catch(e  => { log(`  payables failed (${tallyComp}): ${e.message}`, 'WARN'); return []; });
      await sleep(2000);
      const stock    = await fetchStock().catch(e    => { log(`  stock failed (${tallyComp}): ${e.message}`, 'WARN'); return []; });
      await sleep(2000);
      const vouchers = await fetchVouchers().catch(e => { log(`  vouchers failed (${tallyComp}): ${e.message}`, 'WARN'); return []; });

      log(`    ${tallyComp}: ${ledgers.length} parties | ${bills.length} bills | ${vouchers.length} vouchers`);

      // Tag each record with the source company year so server can merge intelligently
      allLedgers  = allLedgers.concat(ledgers.map(r  => ({...r,  tally_source: tallyComp})));
      allBills    = allBills.concat(bills.map(r    => ({...r,  tally_source: tallyComp})));
      allPayables = allPayables.concat(payables.map(r => ({...r, tally_source: tallyComp})));
      allStock    = allStock.concat(stock.map(r    => ({...r,  tally_source: tallyComp})));
      allVouchers = allVouchers.concat(vouchers.map(r => ({...r, tally_source: tallyComp})));

      if (TALLY_COMPANIES.length > 1) await sleep(3000); // breathe between companies
    }

    log(`  Total merged: ${allLedgers.length} parties | ${allBills.length} bills | ${allVouchers.length} vouchers | ${allStock.length} stock`);
    const res = await pushToServer({
      company_code,
      tally_company: TALLY_COMPANIES.join(', '),
      tally_companies: TALLY_COMPANIES,
      hostname: HOSTNAME, agent_version: VERSION,
      synced_at: new Date().toISOString(),
      ledgers: allLedgers, bills: allBills, vouchers: allVouchers,
      stock: allStock, payables: allPayables,
    });
    lastSyncAt = new Date();
    fails = 0;
    log(`  Server OK — parties:${res.parties_upserted} bills:${res.bills_upserted}`);
    log('Sync complete');
  } catch(e) {
    fails++;
    log(`Sync FAILED (attempt ${fails}): ${e.message}`, 'WARN');
  } finally { syncing = false; }
}

async function pollAndExecuteCommands() {
  try {
    const r = await axios.get(CMD_URL, {
      headers:{'X-Agent-Key':api_key,'X-Company-Code':company_code},
      timeout:8000
    });
    const commands = r.data?.commands || [];
    if (!commands.length) return;
    log(`  Commands received: ${commands.length}`);
    for (const cmd of commands) {
      try {
        if (cmd.type === 'ledger_pdf') {
          log(`  Executing ledger_pdf for: ${cmd.ledger_name}`);
          const entries = await fetchPartyLedger(cmd.ledger_name, voucher_days);
          log(`  Got ${entries.length} ledger entries for ${cmd.ledger_name}`);
          await axios.post(`${server_url.replace(/\/$/,'')}/agent/command-result`, {
            command_id: cmd.id, company_code, type: 'ledger_pdf',
            ledger_name: cmd.ledger_name,
            from_date: ago(voucher_days),
            to_date: td(new Date()),
            entries, tally_company,
          }, { headers:{'X-Agent-Key':api_key,'X-Company-Code':company_code}, timeout:30000 });
          log(`  ledger_pdf result pushed for: ${cmd.ledger_name}`);
        }
      } catch(e) {
        log(`  Command ${cmd.id} failed: ${e.message}`, 'WARN');
        await axios.post(`${server_url.replace(/\/$/,'')}/agent/command-result`, {
          command_id: cmd.id, company_code, type: cmd.type, error: e.message,
        }, { headers:{'X-Agent-Key':api_key,'X-Company-Code':company_code}, timeout:8000 }).catch(()=>{});
      }
    }
  } catch(e) { /* silent */ }
}

async function watchLoop() {
  log(`┌┐ Jalan Group Tally Agent v${VERSION} ┌┐`);
  log(`Company: ${company_code} (${currentTallyCompany}) | Server: ${server_url} | Host: ${HOSTNAME}`);
  log(`Check every ${check_interval_sec}s | Sync every ${sync_interval_min}min | Vouchers: last ${voucher_days} days`);
  log(`Working hours guard: ${WORK_START}:00—${WORK_END}:00 (background sync paused during this window)`);
  let hbCount = 0;
  while (true) {
    const procRunning = isTallyRunning();
    const httpReady   = procRunning ? await isTallyHTTPReady() : false;
    hbCount++;
    if (hbCount % 5 === 0) await sendHeartbeat(httpReady);
    if (httpReady) await pollAndExecuteCommands();
    if (httpReady) {
      if (!tallyWasOpen) {
        log('Tally OPENED — syncing immediately');
        tallyWasOpen = true;
        if (!isWorkingHours()) { log('Outside working hours — syncing on open'); await doSync('tally_opened'); }
        else { log(`Working hours (${WORK_START}—${WORK_END}) — skipping sync on open to keep Tally responsive`); }
      } else {
        const mins = lastSyncAt ? (Date.now()-lastSyncAt.getTime())/60000 : Infinity;
        if (mins >= sync_interval_min) {
          if (!isWorkingHours()) await doSync('scheduled');
          else log(`Working hours — skipping scheduled sync (last sync ${Math.round(mins)}min ago)`);
        }
      }
    } else {
      if (procRunning && !httpReady && !tallyWasOpen) log('Tally starting up, waiting...');
      if (tallyWasOpen) { log('Tally CLOSED — pausing sync'); await sendHeartbeat(false); tallyWasOpen = false; }
    }
    await sleep(check_interval_sec * 1000);
  }
}

watchLoop().catch(e => { log(`Fatal: ${e.message}`, 'ERROR'); process.exit(1); });
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
process.on('uncaughtException', e => log(`Uncaught: ${e.message}`, 'ERROR'));