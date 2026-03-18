#!/usr/bin/env node
/**
 * myFindr Monthly Intelligence Report Generator
 * 
 * Pulls last month's DA data from Supabase and generates
 * static HTML reports for Brisbane and Sunshine Coast.
 * 
 * Usage:
 *   node generate-monthly-reports.js
 * 
 * Env vars required (or set in .env):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 * 
 * Output:
 *   ../reports/brisbane-intelligence-report.html
 *   ../reports/sunshinecoast-intelligence-report.html
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── Config ────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ieqbavwzydlxiaclzcjl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY env var required');
  process.exit(1);
}

// ─── Date Logic ─────────────────────────────────────────────────────────────
const now = new Date();
const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
const monthName = lastMonth.toLocaleString('en-AU', { month: 'long' });
const year = lastMonth.getFullYear();
const reportDate = now.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

const dateFrom = lastMonth.toISOString().split('T')[0];
const dateTo = lastMonthEnd.toISOString().split('T')[0];

console.log(`📅 Generating reports for: ${monthName} ${year}`);
console.log(`📆 Date range: ${dateFrom} to ${dateTo}`);

// ─── Supabase Fetch ──────────────────────────────────────────────────────────
function fetchData(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nData: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getDAs(council) {
  const params = new URLSearchParams({
    select: 'suburb,application_type,date_received,decision_description,primary_applicant,consultant,address,application_number,application_link',
    council: `eq.${council}`,
    date_received: `gte.${dateFrom}`,
    limit: '1000'
  });
  // Also filter end date
  const url = `${SUPABASE_URL}/rest/v1/da_submissions?${params}&date_received=lte.${dateTo}`;
  return fetchData(url);
}

// ─── Data Analysis ───────────────────────────────────────────────────────────
function counter(arr) {
  return arr.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

function topN(obj, n = 10) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function analyzeData(das) {
  const total = das.length;
  
  // Suburbs
  const suburbs = counter(das.map(d => (d.suburb || '').toUpperCase().trim()).filter(Boolean));
  const topSuburbs = topN(suburbs, 10);
  
  // Application types
  const types = counter(das.map(d => d.application_type || 'Unknown'));
  const topTypes = topN(types, 10);
  
  // Decisions
  const decisions = counter(das.map(d => d.decision_description || 'Unknown'));
  
  // Consultants (dedup by uppercase)
  const consultantMap = {};
  das.forEach(d => {
    const c = (d.consultant || '').trim();
    if (c && c.length < 80) {
      const key = c.toUpperCase();
      consultantMap[key] = { name: c, count: (consultantMap[key]?.count || 0) + 1 };
    }
  });
  const topConsultants = Object.values(consultantMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Notable DAs (MCU + Reconfigure combined = biggest signal)
  const notables = das.filter(d => {
    const t = d.application_type || '';
    return (t.includes('Material Change') && t.includes('Reconfigure')) ||
           (t.includes('Material Change Of Use') && d.primary_applicant && d.primary_applicant.match(/\d+.*[Uu]nit|[Dd]welling|[Mm]ulti/));
  }).slice(0, 5);
  
  // Most active suburb
  const topSuburb = topSuburbs[0]?.[0] || 'N/A';
  
  return { total, topSuburbs, topTypes, decisions, topConsultants, notables, topSuburb };
}

// ─── HTML Generators ─────────────────────────────────────────────────────────

function barRow(name, count, maxCount, pct, color = '#E64500') {
  const fillPct = Math.round((count / maxCount) * 100);
  return `
    <div class="bar-row">
      <div class="bar-name">${esc(titleCase(name))}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${fillPct}%;background:linear-gradient(90deg,${color},${color}cc)"></div></div>
      <div class="bar-count" style="color:${color}">${count}</div>
      <div class="bar-pct">${pct.toFixed(1)}%</div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function titleCase(s) {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function daCard(da, accentColor) {
  const link = da.application_link || '#';
  const ref = da.application_number || 'View DA';
  return `
  <div class="da-card">
    <div class="da-card-header">
      <div class="da-addr">${esc(da.address || 'Address not available')}</div>
      <a href="${esc(link)}" target="_blank" rel="noopener" class="da-ref" style="color:${accentColor};background:${accentColor}14;border-color:${accentColor}33">📋 ${esc(ref)} →</a>
      <div class="da-meta">
        <span class="tag">${esc(da.application_type || '')}</span>
        ${da.decision_description ? `<span class="tag">${esc(da.decision_description)}</span>` : ''}
      </div>
      <div class="da-note">Applicant: ${esc(da.primary_applicant || 'Not specified')} · Lodged ${esc(da.date_received || '')}</div>
    </div>
  </div>`;
}

function consultantRow(rank, consultant, maxCount) {
  const fillPct = Math.round((consultant.count / maxCount) * 100);
  return `
      <tr>
        <td class="rank">${rank}</td>
        <td class="cname">${esc(consultant.name)}</td>
        <td><strong>${consultant.count}</strong></td>
        <td><div class="cbar-wrap"><div class="cbar"><div class="cfill" style="width:${fillPct}%"></div></div></div></td>
        <td><span style="font-size:10px;font-weight:700;background:${consultant.count >= 5 ? '#ffe0db' : consultant.count >= 3 ? '#fff3cd' : '#f0f0f0'};color:${consultant.count >= 5 ? '#c0392b' : consultant.count >= 3 ? '#b8860b' : '#555'};padding:2px 7px;border-radius:10px">${consultant.count >= 5 ? '🔥 High Volume' : consultant.count >= 3 ? '📈 Active' : 'Steady'}</span></td>
      </tr>`;
}

// ─── Brisbane HTML ────────────────────────────────────────────────────────────
function generateBrisbaneHTML(das) {
  const { total, topSuburbs, topTypes, decisions, topConsultants, notables, topSuburb } = analyzeData(das);
  const maxSuburbCount = topSuburbs[0]?.[1] || 1;
  const maxConsultantCount = topConsultants[0]?.count || 1;
  
  const decidedCount = (decisions['Decision'] || 0) + (decisions['Approved'] || 0);
  const inProgressCount = total - decidedCount;
  const uniqueSuburbs = Object.keys(counter(das.map(d => d.suburb).filter(Boolean))).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>myFindr — Greater Brisbane DA Intelligence Report · ${monthName} ${year}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,sans-serif;background:#f8f8f6;color:#121212;font-size:14px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:700px;margin:0 auto;background:#fff}
.header{background:#121212;padding:20px 28px;display:flex;justify-content:space-between;align-items:center}
.header-right{text-align:right}
.header-right strong{color:#fff;font-size:12px;display:block}
.header-right small{color:#555;font-size:10px}
.hero{background:linear-gradient(135deg,#E64500,#c93a00);padding:36px 28px;color:#fff}
.eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;opacity:.7;margin-bottom:10px}
.hero h1{font-size:26px;font-weight:900;letter-spacing:-.6px;line-height:1.15;margin-bottom:10px}
.hero p{font-size:13px;opacity:.85;line-height:1.7;max-width:520px}
.hero-meta{display:flex;gap:20px;margin-top:18px;flex-wrap:wrap}
.hero-stat{background:rgba(0,0,0,.2);border-radius:8px;padding:12px 16px;text-align:center;min-width:100px}
.hero-stat-num{font-size:28px;font-weight:900;line-height:1}
.hero-stat-label{font-size:10px;opacity:.7;margin-top:3px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.sec{padding:28px;border-bottom:1px solid #efefed;background:#fff}
.sec.alt{background:#fafaf8}
.sec-label{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#E64500;margin-bottom:5px}
.sec-title{font-size:18px;font-weight:900;letter-spacing:-.4px;margin-bottom:3px}
.sec-sub{font-size:12px;color:#888;margin-bottom:18px}
.insight{background:#fff8f6;border-left:3px solid #E64500;padding:14px 16px;margin-bottom:10px;border-radius:0 8px 8px 0}
.insight h3{font-size:12px;font-weight:700;margin-bottom:5px}
.insight p{font-size:12px;color:#555;line-height:1.6}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.stat-box{background:#fff;border:1px solid #e8e8e5;border-radius:10px;padding:16px;text-align:center}
.stat-box .num{font-size:32px;font-weight:900;color:#E64500;line-height:1}
.stat-box .lbl{font-size:11px;color:#888;margin-top:4px;font-weight:600}
.stat-box.accent{background:#E64500;border-color:#E64500}
.stat-box.accent .num,.stat-box.accent .lbl{color:#fff}
.stat-box.accent .lbl{opacity:.7}
.bar-list{display:flex;flex-direction:column;gap:8px}
.bar-row{display:flex;align-items:center;gap:10px}
.bar-name{font-size:12px;font-weight:700;width:150px;flex-shrink:0}
.bar-track{flex:1;background:#f0f0ee;border-radius:4px;height:20px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px}
.bar-count{font-size:12px;font-weight:700;width:28px;text-align:right;flex-shrink:0}
.bar-pct{font-size:10px;color:#aaa;width:36px;text-align:right;flex-shrink:0}
.type-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
.type-card{background:#f8f8f6;border-radius:8px;padding:12px 14px}
.type-num{font-size:24px;font-weight:900;line-height:1}
.type-lbl{font-size:11px;color:#666;margin-top:2px;font-weight:600}
.ctable{width:100%;border-collapse:collapse;font-size:12px}
.ctable th{text-align:left;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#999;padding:6px 10px;border-bottom:2px solid #f0f0ee}
.ctable td{padding:9px 10px;border-bottom:1px solid #f5f5f3;vertical-align:middle}
.rank{color:#888;font-size:11px;width:24px}
.cname{font-weight:700}
.cbar-wrap{display:flex;align-items:center;gap:8px}
.cbar{height:6px;background:#f0f0f0;border-radius:3px;width:80px;overflow:hidden;flex-shrink:0}
.cfill{height:100%;border-radius:3px;background:linear-gradient(90deg,#E64500,#FA5914)}
.da-card{border:1px solid #e8e8e5;border-radius:10px;margin-bottom:12px;background:#fff;overflow:hidden}
.da-card-header{padding:14px 16px 10px}
.da-addr{font-size:14px;font-weight:800;letter-spacing:-.2px;margin-bottom:4px}
.da-ref{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;text-decoration:none;border-radius:4px;padding:2px 8px;margin-bottom:8px}
.da-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.tag{display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:16px;background:#f0f0f0;color:#555}
.da-note{font-size:11px;color:#888;margin-top:6px}
.cta{background:#121212;padding:40px 28px;text-align:center;color:#fff}
.cta h2{font-size:22px;font-weight:900;letter-spacing:-.4px;margin-bottom:8px}
.cta p{color:#666;font-size:13px;max-width:440px;margin:0 auto 24px;line-height:1.7}
.cta-btn{display:inline-block;background:linear-gradient(135deg,#E64500,#FA5914);color:#fff;font-weight:700;font-size:13px;padding:14px 34px;border-radius:8px;text-decoration:none}
.footer{background:#0a0a0a;padding:16px 28px;display:flex;justify-content:space-between;align-items:center}
.footer p{font-size:10px;color:#333;line-height:1.7}
@media(max-width:500px){.stat-grid{grid-template-columns:1fr 1fr}.type-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="page">
<div class="header">
  <img src="../myfindr-logo-white.svg" alt="myFindr" style="height:26px">
  <div class="header-right">
    <strong>Greater Brisbane DA Intelligence Report</strong>
    <small>Data period: ${monthName} ${year} &nbsp;·&nbsp; Generated ${reportDate}</small>
  </div>
</div>
<div class="hero">
  <div class="eyebrow">myFindr · Monthly Intelligence · Brisbane City Council</div>
  <h1>Greater Brisbane DA Intelligence<br>Report — ${monthName} ${year}</h1>
  <p>${total} planning applications tracked across Brisbane City Council this month. Here's what the data reveals.</p>
  <div class="hero-meta">
    <div class="hero-stat"><div class="hero-stat-num">${total}</div><div class="hero-stat-label">Total DAs</div></div>
    <div class="hero-stat"><div class="hero-stat-num">${Math.round((inProgressCount/total)*100)}%</div><div class="hero-stat-label">In Progress</div></div>
    <div class="hero-stat"><div class="hero-stat-num">${uniqueSuburbs}</div><div class="hero-stat-label">Active Suburbs</div></div>
    <div class="hero-stat"><div class="hero-stat-num">${esc(titleCase(topSuburb))}</div><div class="hero-stat-label">Most Active</div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-label">Section 1</div>
  <div class="sec-title">Executive Summary</div>
  <div class="sec-sub">Brisbane City Council · ${monthName} ${year} data snapshot</div>
  <div class="stat-grid">
    <div class="stat-box accent"><div class="num">${total}</div><div class="lbl">DAs Submitted</div></div>
    <div class="stat-box"><div class="num">${decidedCount || '—'}</div><div class="lbl">Decisions Issued</div></div>
    <div class="stat-box"><div class="num">${decisions['Lodgement'] || 0}</div><div class="lbl">At Lodgement</div></div>
    <div class="stat-box"><div class="num">${(decisions['With Customer'] || 0) + (decisions['Application'] || 0)}</div><div class="lbl">Under Assessment</div></div>
  </div>
  <div class="insight"><h3>📊 ${monthName} ${year} — Brisbane DA snapshot</h3><p>${total} applications lodged across Brisbane City Council. The top suburb is ${esc(titleCase(topSuburb))} with ${topSuburbs[0]?.[1] || 0} DAs. Activity is spread across ${uniqueSuburbs} suburbs, signalling broad-based market momentum.</p></div>
  <div class="insight"><h3>📍 Top application type: ${esc(topTypes[0]?.[0] || 'N/A')} (${topTypes[0]?.[1] || 0} DAs)</h3><p>This represents the largest share of Brisbane's development activity this month. For businesses targeting early-stage projects, these applications represent the freshest pipeline of opportunity.</p></div>
</div>
<div class="sec alt">
  <div class="sec-label">Section 2</div>
  <div class="sec-title">Top Suburbs by DA Activity</div>
  <div class="sec-sub">${monthName} ${year} · Top 10 suburbs by application volume (${total} total)</div>
  <div class="bar-list">
    ${topSuburbs.map(([s, n]) => barRow(s, n, maxSuburbCount, (n/total)*100)).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-label">Section 3</div>
  <div class="sec-title">Application Type Breakdown</div>
  <div class="sec-sub">What type of development is happening across Brisbane · ${monthName} ${year}</div>
  <div class="type-grid">
    ${topTypes.slice(0, 6).map(([ t, n ], i) => {
      const colors = ['#E64500','#2c4fbb','#1a7a4a','#b8860b','#7c5cbf','#888'];
      return `<div class="type-card" style="border-left:3px solid ${colors[i]}"><div class="type-num" style="color:${colors[i]}">${n}</div><div class="type-lbl">${esc(t)}</div></div>`;
    }).join('')}
  </div>
</div>
<div class="sec alt">
  <div class="sec-label">Section 4</div>
  <div class="sec-title">Consultant Activity — Who's Lodging DAs</div>
  <div class="sec-sub">Top planning consultants by submission volume · ${monthName} ${year}</div>
  ${topConsultants.length > 0 ? `
  <table class="ctable">
    <thead><tr><th>#</th><th>Consultant / Firm</th><th>DAs</th><th>Volume</th><th>Signal</th></tr></thead>
    <tbody>
      ${topConsultants.map((c, i) => consultantRow(i+1, c, maxConsultantCount)).join('')}
    </tbody>
  </table>` : '<p style="color:#888;font-size:12px">No consultant data available for this period.</p>'}
</div>
<div class="sec">
  <div class="sec-label">Section 5</div>
  <div class="sec-title">Notable DAs This Month</div>
  <div class="sec-sub">Significant applications tracked this month</div>
  ${notables.length > 0 ? notables.map(d => daCard(d, '#E64500')).join('') : '<div class="insight"><h3>📋 All DAs available in full myFindr dashboard</h3><p>Notable multi-dwelling and complex applications are identified and flagged in real-time for myFindr subscribers.</p></div>'}
</div>
<div class="cta">
  <h2>Want this intelligence every month?</h2>
  <p>Get full access to real-time DA data for Greater Brisbane. Filter by suburb, type, or project stage — delivered to you daily.</p>
  <a href="https://app.myfindr.com.au" class="cta-btn">Get Full Access to Brisbane DA Data →</a>
  <div style="margin-top:14px;font-size:11px;color:#444">Start free · No credit card required</div>
</div>
<div class="footer">
  <p>© ${year} myFindr<br>Data sourced from Brisbane City Council</p>
  <p style="text-align:right">myfindr.com.au<br>Report generated ${reportDate}</p>
</div>
</div>
</body>
</html>`;
}

// ─── Sunshine Coast HTML ──────────────────────────────────────────────────────
function generateSunshineCoastHTML(das) {
  const { total, topSuburbs, topTypes, decisions, topConsultants, notables, topSuburb } = analyzeData(das);
  const maxSuburbCount = topSuburbs[0]?.[1] || 1;
  const maxConsultantCount = topConsultants[0]?.count || 1;
  const uniqueSuburbs = Object.keys(counter(das.map(d => d.suburb).filter(s => s && s !== 'Unknown'))).length;
  const underAssessment = (decisions['Application undergoing assessment'] || 0) + (decisions['Decision Period Commenced'] || 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>myFindr — Sunshine Coast DA Intelligence Report · ${monthName} ${year}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,sans-serif;background:#f8f8f6;color:#121212;font-size:14px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:700px;margin:0 auto;background:#fff}
.header{background:#121212;padding:20px 28px;display:flex;justify-content:space-between;align-items:center}
.header-right{text-align:right}
.header-right strong{color:#fff;font-size:12px;display:block}
.header-right small{color:#555;font-size:10px}
.hero{background:linear-gradient(135deg,#0074c2,#005a9a);padding:36px 28px;color:#fff}
.eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;opacity:.7;margin-bottom:10px}
.hero h1{font-size:26px;font-weight:900;letter-spacing:-.6px;line-height:1.15;margin-bottom:10px}
.hero p{font-size:13px;opacity:.85;line-height:1.7;max-width:520px}
.hero-meta{display:flex;gap:20px;margin-top:18px;flex-wrap:wrap}
.hero-stat{background:rgba(0,0,0,.2);border-radius:8px;padding:12px 16px;text-align:center;min-width:100px}
.hero-stat-num{font-size:28px;font-weight:900;line-height:1}
.hero-stat-label{font-size:10px;opacity:.7;margin-top:3px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.sec{padding:28px;border-bottom:1px solid #efefed;background:#fff}
.sec.alt{background:#fafaf8}
.sec-label{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#0074c2;margin-bottom:5px}
.sec-title{font-size:18px;font-weight:900;letter-spacing:-.4px;margin-bottom:3px}
.sec-sub{font-size:12px;color:#888;margin-bottom:18px}
.insight{background:#f0f7ff;border-left:3px solid #0074c2;padding:14px 16px;margin-bottom:10px;border-radius:0 8px 8px 0}
.insight h3{font-size:12px;font-weight:700;margin-bottom:5px}
.insight p{font-size:12px;color:#555;line-height:1.6}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
.stat-box{background:#fff;border:1px solid #e8e8e5;border-radius:10px;padding:16px;text-align:center}
.stat-box .num{font-size:32px;font-weight:900;color:#0074c2;line-height:1}
.stat-box .lbl{font-size:11px;color:#888;margin-top:4px;font-weight:600}
.stat-box.accent{background:#0074c2;border-color:#0074c2}
.stat-box.accent .num,.stat-box.accent .lbl{color:#fff}
.stat-box.accent .lbl{opacity:.7}
.bar-list{display:flex;flex-direction:column;gap:8px}
.bar-row{display:flex;align-items:center;gap:10px}
.bar-name{font-size:12px;font-weight:700;width:150px;flex-shrink:0}
.bar-track{flex:1;background:#f0f0ee;border-radius:4px;height:20px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px}
.bar-count{font-size:12px;font-weight:700;width:28px;text-align:right;flex-shrink:0}
.bar-pct{font-size:10px;color:#aaa;width:36px;text-align:right;flex-shrink:0}
.type-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px}
.type-card{background:#f8f8f6;border-radius:8px;padding:12px 14px}
.type-num{font-size:24px;font-weight:900;line-height:1}
.type-lbl{font-size:11px;color:#666;margin-top:2px;font-weight:600}
.ctable{width:100%;border-collapse:collapse;font-size:12px}
.ctable th{text-align:left;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#999;padding:6px 10px;border-bottom:2px solid #f0f0ee}
.ctable td{padding:9px 10px;border-bottom:1px solid #f5f5f3;vertical-align:middle}
.rank{color:#888;font-size:11px;width:24px}
.cname{font-weight:700}
.cbar-wrap{display:flex;align-items:center;gap:8px}
.cbar{height:6px;background:#f0f0f0;border-radius:3px;width:80px;overflow:hidden;flex-shrink:0}
.cfill{height:100%;border-radius:3px;background:linear-gradient(90deg,#0074c2,#00a8e8)}
.da-card{border:1px solid #e8e8e5;border-radius:10px;margin-bottom:12px;background:#fff;overflow:hidden}
.da-card-header{padding:14px 16px 10px}
.da-addr{font-size:14px;font-weight:800;letter-spacing:-.2px;margin-bottom:4px}
.da-ref{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;text-decoration:none;border-radius:4px;padding:2px 8px;margin-bottom:8px}
.da-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.tag{display:inline-block;font-size:10px;font-weight:600;padding:2px 8px;border-radius:16px;background:#f0f0f0;color:#555}
.da-note{font-size:11px;color:#888;margin-top:6px}
.cta{background:#121212;padding:40px 28px;text-align:center;color:#fff}
.cta h2{font-size:22px;font-weight:900;letter-spacing:-.4px;margin-bottom:8px}
.cta p{color:#666;font-size:13px;max-width:440px;margin:0 auto 24px;line-height:1.7}
.cta-btn{display:inline-block;background:linear-gradient(135deg,#0074c2,#00a8e8);color:#fff;font-weight:700;font-size:13px;padding:14px 34px;border-radius:8px;text-decoration:none}
.footer{background:#0a0a0a;padding:16px 28px;display:flex;justify-content:space-between;align-items:center}
.footer p{font-size:10px;color:#333;line-height:1.7}
@media(max-width:500px){.stat-grid{grid-template-columns:1fr 1fr}.type-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="page">
<div class="header">
  <img src="../myfindr-logo-white.svg" alt="myFindr" style="height:26px">
  <div class="header-right">
    <strong>Sunshine Coast DA Intelligence Report</strong>
    <small>Data period: ${monthName} ${year} &nbsp;·&nbsp; Generated ${reportDate}</small>
  </div>
</div>
<div class="hero">
  <div class="eyebrow">myFindr · Monthly Intelligence · Sunshine Coast Regional Council</div>
  <h1>Sunshine Coast DA Intelligence<br>Report — ${monthName} ${year}</h1>
  <p>${total} planning applications tracked across Sunshine Coast Regional Council this month.</p>
  <div class="hero-meta">
    <div class="hero-stat"><div class="hero-stat-num">${total}</div><div class="hero-stat-label">Total DAs</div></div>
    <div class="hero-stat"><div class="hero-stat-num">${underAssessment}</div><div class="hero-stat-label">Under Assessment</div></div>
    <div class="hero-stat"><div class="hero-stat-num">${uniqueSuburbs}</div><div class="hero-stat-label">Active Suburbs</div></div>
    <div class="hero-stat"><div class="hero-stat-num">${esc(titleCase(topSuburb.replace('Unknown','').trim() || 'Maroochydore'))}</div><div class="hero-stat-label">Most Active</div></div>
  </div>
</div>
<div class="sec">
  <div class="sec-label">Section 1</div>
  <div class="sec-title">Executive Summary</div>
  <div class="sec-sub">Sunshine Coast Regional Council · ${monthName} ${year} data snapshot</div>
  <div class="stat-grid">
    <div class="stat-box accent"><div class="num">${total}</div><div class="lbl">DAs This Month</div></div>
    <div class="stat-box"><div class="num">${underAssessment}</div><div class="lbl">Under Assessment</div></div>
    <div class="stat-box"><div class="num">${decisions['Decision Period Commenced'] || 0}</div><div class="lbl">Decision Period</div></div>
    <div class="stat-box"><div class="num">${uniqueSuburbs}</div><div class="lbl">Active Suburbs</div></div>
  </div>
  <div class="insight"><h3>📊 ${monthName} ${year} — Sunshine Coast DA snapshot</h3><p>${total} applications tracked across the Sunshine Coast Regional Council. The most active suburb is ${esc(titleCase(topSuburb))} with ${topSuburbs[0]?.[1] || 0} DAs. Development activity spans ${uniqueSuburbs} suburbs.</p></div>
  <div class="insight"><h3>🏗️ ${esc(topTypes[0]?.[0] || 'Operational Works')} leads at ${topTypes[0]?.[1] || 0} applications</h3><p>This signals the Sunshine Coast's active construction phase — projects already approved are now moving into civil and infrastructure works. This is the most actionable pipeline for trade suppliers and construction businesses.</p></div>
</div>
<div class="sec alt">
  <div class="sec-label">Section 2</div>
  <div class="sec-title">Top Suburbs by DA Activity</div>
  <div class="sec-sub">${monthName} ${year} · Top 10 suburbs by application volume</div>
  <div class="bar-list">
    ${topSuburbs.filter(([s]) => s && s !== 'Unknown').map(([s, n]) => barRow(s, n, maxSuburbCount, (n/total)*100, '#0074c2')).join('')}
  </div>
</div>
<div class="sec">
  <div class="sec-label">Section 3</div>
  <div class="sec-title">Application Type Breakdown</div>
  <div class="sec-sub">${monthName} ${year} · Sunshine Coast development activity by type</div>
  <div class="type-grid">
    ${topTypes.slice(0, 6).map(([t, n], i) => {
      const colors = ['#0074c2','#E64500','#1a7a4a','#b8860b','#7c5cbf','#888'];
      return `<div class="type-card" style="border-left:3px solid ${colors[i]}"><div class="type-num" style="color:${colors[i]}">${n}</div><div class="type-lbl">${esc(t)}</div></div>`;
    }).join('')}
  </div>
</div>
<div class="sec alt">
  <div class="sec-label">Section 4</div>
  <div class="sec-title">Consultant Activity</div>
  <div class="sec-sub">Active planning consultants · ${monthName} ${year}</div>
  ${topConsultants.length > 0 ? `
  <table class="ctable">
    <thead><tr><th>#</th><th>Consultant / Firm</th><th>DAs</th><th>Volume</th><th>Signal</th></tr></thead>
    <tbody>
      ${topConsultants.map((c, i) => consultantRow(i+1, c, maxConsultantCount)).join('')}
    </tbody>
  </table>` : '<div class="insight"><h3>ℹ️ Consultant data</h3><p>Sunshine Coast DA records embed consultant information within application descriptions. Full consultant intelligence is available to myFindr subscribers through our enhanced data layer.</p></div>'}
</div>
<div class="sec">
  <div class="sec-label">Section 5</div>
  <div class="sec-title">Notable DAs This Month</div>
  <div class="sec-sub">Significant applications tracked this month</div>
  ${notables.length > 0 ? notables.map(d => daCard(d, '#0074c2')).join('') : '<div class="insight"><h3>📋 DA intelligence available in full myFindr dashboard</h3><p>Multi-dwelling, master-planned community, and major infrastructure applications are tracked and flagged in real-time for myFindr subscribers.</p></div>'}
</div>
<div class="cta">
  <h2>Want this intelligence every month?</h2>
  <p>Get full access to real-time DA data for the Sunshine Coast. Filter by suburb, type, or project stage — delivered to you daily.</p>
  <a href="https://app.myfindr.com.au" class="cta-btn">Get Full Access to Sunshine Coast DA Data →</a>
  <div style="margin-top:14px;font-size:11px;color:#444">Start free · No credit card required</div>
</div>
<div class="footer">
  <p>© ${year} myFindr<br>Data sourced from Sunshine Coast Regional Council</p>
  <p style="text-align:right">myfindr.com.au<br>Report generated ${reportDate}</p>
</div>
</div>
</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const outputDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('\n📥 Fetching Brisbane DAs...');
  const brisbaneDAs = await getDAs('brisbane');
  console.log(`   Found ${brisbaneDAs.length} Brisbane DAs for ${monthName} ${year}`);

  console.log('📥 Fetching Sunshine Coast DAs...');
  const scDAs = await getDAs('sunshine_coast');
  console.log(`   Found ${scDAs.length} Sunshine Coast DAs for ${monthName} ${year}`);

  if (brisbaneDAs.length === 0) {
    console.warn(`⚠️  No Brisbane DAs found for ${dateFrom} to ${dateTo}. Report will show empty data.`);
  }
  if (scDAs.length === 0) {
    console.warn(`⚠️  No Sunshine Coast DAs found for ${dateFrom} to ${dateTo}. Report will show empty data.`);
  }

  console.log('\n🏗️  Generating Brisbane report...');
  const brisbaneHTML = generateBrisbaneHTML(brisbaneDAs);
  const brisbanePath = path.join(outputDir, 'brisbane-intelligence-report.html');
  fs.writeFileSync(brisbanePath, brisbaneHTML);
  console.log(`   ✅ Saved: ${brisbanePath}`);

  console.log('🏖️  Generating Sunshine Coast report...');
  const scHTML = generateSunshineCoastHTML(scDAs);
  const scPath = path.join(outputDir, 'sunshinecoast-intelligence-report.html');
  fs.writeFileSync(scPath, scHTML);
  console.log(`   ✅ Saved: ${scPath}`);

  console.log(`\n✅ Done! Reports generated for ${monthName} ${year}`);
  console.log(`   Brisbane: ${brisbanePath}`);
  console.log(`   Sunshine Coast: ${scPath}`);
  console.log('\nTo deploy: cd /private/tmp/myfindr-previews && vercel --prod');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
