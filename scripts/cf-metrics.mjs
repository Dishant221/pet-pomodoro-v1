#!/usr/bin/env node
// Cloudflare metrics for PetPomo (pomodoropet.com + the petpomo Workers).
//
//   npm run metrics            # last 30 days
//   npm run metrics -- 7       # last 7 days
//   node scripts/cf-metrics.mjs 30 --json > out.json   # raw data instead of the summary
//
// Auth: a READ-ONLY API token in the env var `dt_claude_api_cloudflare_token`
// (stored as a Windows *user* environment variable — see CLOUDFLARE-OPS.md).
// Fresh shells spawned by tools do not inherit it; load it first in PowerShell:
//   $env:dt_claude_api_cloudflare_token = [Environment]::GetEnvironmentVariable("dt_claude_api_cloudflare_token","User")
//
// Free-plan limits (zone is on "Free Website"): per-path/user-agent data
// (httpRequestsAdaptiveGroups) only allows a 1-day window, and bot-score,
// referrer and ASN fields are not available at all.

const tok = process.env.dt_claude_api_cloudflare_token || process.env.CLOUDFLARE_API_TOKEN;
if (!tok) {
  console.error("Missing token: set dt_claude_api_cloudflare_token (or CLOUDFLARE_API_TOKEN).");
  process.exit(1);
}

const ACCOUNT = "ee40c9f799262b5a70891635b53555cd"; // the PetPomo account (see CLOUDFLARE-OPS.md)
const ZONE = "ac7ceff9a6819a02ec9c49871c70c2f0"; // pomodoropet.com
const WORKERS = ["petpomo", "petpomo-preview"];

const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) || 30);
const rawJson = args.includes("--json");

const end = new Date();
const start = new Date(end.getTime() - days * 86400000);
const dayAgo = new Date(end.getTime() - 23.5 * 3600000);
const iso = (d) => d.toISOString();
const day = (d) => d.toISOString().slice(0, 10);
const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

async function gql(query, variables) {
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) return { errors: j.errors.map((e) => e.message) };
  return j.data;
}
async function rest(path) {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: H });
  return r.json();
}

// ---------------------------------------------------------------- fetch
const out = { range: { start: iso(start), end: iso(end), days } };

const scripts = await rest(`/accounts/${ACCOUNT}/workers/scripts`);
out.workers = scripts.success ? scripts.result.map((s) => ({ name: s.id, modified: s.modified_on })) : scripts.errors;

out.workerDaily = await gql(
  `query($a:String!,$s:Time!,$e:Time!){ viewer{ accounts(filter:{accountTag:$a}){
    workersInvocationsAdaptive(limit:5000, filter:{datetime_geq:$s, datetime_leq:$e}, orderBy:[date_ASC]){
      sum{ requests errors subrequests }
      quantiles{ cpuTimeP50 cpuTimeP99 }
      dimensions{ scriptName date status }
    } } } }`,
  { a: ACCOUNT, s: iso(start), e: iso(end) },
);

out.zoneDaily = await gql(
  `query($z:String!,$s:Date!,$e:Date!){ viewer{ zones(filter:{zoneTag:$z}){
    httpRequests1dGroups(limit:100, filter:{date_geq:$s, date_leq:$e}, orderBy:[date_ASC]){
      dimensions{ date }
      sum{ requests pageViews bytes cachedRequests threats
           countryMap{ clientCountryName requests }
           responseStatusMap{ edgeResponseStatus requests }
           browserMap{ uaBrowserFamily pageViews } }
      uniq{ uniques }
    } } } }`,
  { z: ZONE, s: day(start), e: day(end) },
);

// 1-day window only (free plan)
out.lastDay = await gql(
  `query($z:String!,$s:Time!,$e:Time!){ viewer{ zones(filter:{zoneTag:$z}){
    top:httpRequestsAdaptiveGroups(limit:20,filter:{datetime_geq:$s,datetime_leq:$e,requestSource:"eyeball",edgeResponseStatus:200},orderBy:[count_DESC]){count dimensions{clientRequestPath}}
    notfound:httpRequestsAdaptiveGroups(limit:15,filter:{datetime_geq:$s,datetime_leq:$e,edgeResponseStatus:404},orderBy:[count_DESC]){count dimensions{clientRequestPath}}
    blocked:httpRequestsAdaptiveGroups(limit:10,filter:{datetime_geq:$s,datetime_leq:$e,edgeResponseStatus:403},orderBy:[count_DESC]){count dimensions{clientRequestPath}}
    ua:httpRequestsAdaptiveGroups(limit:25,filter:{datetime_geq:$s,datetime_leq:$e,requestSource:"eyeball"},orderBy:[count_DESC]){count dimensions{userAgent}}
    dev:httpRequestsAdaptiveGroups(limit:5,filter:{datetime_geq:$s,datetime_leq:$e,requestSource:"eyeball"},orderBy:[count_DESC]){count dimensions{clientDeviceType}}
    sess:httpRequestsAdaptiveGroups(limit:10,filter:{datetime_geq:$s,datetime_leq:$e,clientRequestPath:"/api/auth/get-session"},orderBy:[count_DESC]){count dimensions{clientCountryName}}
  } } }`,
  { z: ZONE, s: iso(dayAgo), e: iso(end) },
);

out.d1 = await gql(
  `query($a:String!,$s:Time!,$e:Time!){ viewer{ accounts(filter:{accountTag:$a}){
    d1AnalyticsAdaptiveGroups(limit:1000, filter:{datetime_geq:$s, datetime_leq:$e}){
      sum{ readQueries writeQueries rowsRead rowsWritten }
      dimensions{ databaseId }
    } } } }`,
  { a: ACCOUNT, s: iso(start), e: iso(end) },
);
const dbs = await rest(`/accounts/${ACCOUNT}/d1/database`);
out.d1Databases = dbs.success ? dbs.result.map((d) => ({ name: d.name, uuid: d.uuid })) : dbs.errors;

if (rawJson) {
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}

// ---------------------------------------------------------------- summarise
const errs = {};
for (const k of ["workerDaily", "zoneDaily", "lastDay", "d1"]) if (out[k]?.errors) errs[k] = out[k].errors;
if (Object.keys(errs).length) console.log("QUERY ERRORS:", JSON.stringify(errs, null, 1), "\n");

console.log(`PetPomo Cloudflare metrics, last ${days} days (${day(start)} to ${day(end)})\n`);

// Workers
const inv = out.workerDaily?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
const perScript = {};
for (const r of inv) {
  const s = r.dimensions.scriptName;
  if (!WORKERS.includes(s)) continue;
  perScript[s] ??= { requests: 0, errors: 0, subrequests: 0, statuses: {}, days: {}, cpuP50: [], cpuP99: [] };
  const p = perScript[s];
  p.requests += r.sum.requests;
  p.errors += r.sum.errors;
  p.subrequests += r.sum.subrequests;
  p.statuses[r.dimensions.status] = (p.statuses[r.dimensions.status] || 0) + r.sum.requests;
  p.days[r.dimensions.date] = (p.days[r.dimensions.date] || 0) + r.sum.requests;
  if (r.dimensions.status === "success") {
    p.cpuP50.push(r.quantiles.cpuTimeP50);
    p.cpuP99.push(r.quantiles.cpuTimeP99);
  }
}
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
console.log("WORKERS");
for (const [s, p] of Object.entries(perScript)) {
  console.log(`  ${s}: requests=${p.requests} errors=${p.errors} subrequests=${p.subrequests} cpuP50~${med(p.cpuP50)}us cpuP99~${med(p.cpuP99)}us`);
  console.log(`    statuses: ${JSON.stringify(p.statuses)}`);
  console.log(`    daily:    ${Object.entries(p.days).map(([k, v]) => `${k.slice(5)}:${v}`).join(" ")}`);
}

// Zone
const z = out.zoneDaily?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
const tot = { requests: 0, pageViews: 0, bytes: 0, cached: 0, threats: 0 };
const countries = {}, statuses = {}, browsers = {};
console.log("\nZONE pomodoropet.com  (date  requests  pageViews  uniqueIPs  cachedRequests)");
for (const r of z) {
  tot.requests += r.sum.requests; tot.pageViews += r.sum.pageViews; tot.bytes += r.sum.bytes;
  tot.cached += r.sum.cachedRequests; tot.threats += r.sum.threats;
  for (const c of r.sum.countryMap) countries[c.clientCountryName] = (countries[c.clientCountryName] || 0) + c.requests;
  for (const c of r.sum.responseStatusMap) statuses[c.edgeResponseStatus] = (statuses[c.edgeResponseStatus] || 0) + c.requests;
  for (const c of r.sum.browserMap) browsers[c.uaBrowserFamily] = (browsers[c.uaBrowserFamily] || 0) + c.pageViews;
  console.log(`  ${r.dimensions.date}  ${String(r.sum.requests).padStart(6)}  ${String(r.sum.pageViews).padStart(6)}  ${String(r.uniq.uniques).padStart(6)}  ${String(r.sum.cachedRequests).padStart(6)}`);
}
const top = (o, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join(", ");
console.log(`  totals: requests=${tot.requests} pageViews=${tot.pageViews} cached=${tot.cached} (${tot.requests ? Math.round((100 * tot.cached) / tot.requests) : 0}%) threats=${tot.threats} MB=${(tot.bytes / 1e6).toFixed(1)}`);
console.log(`  countries: ${top(countries)}`);
console.log(`  statuses:  ${top(statuses)}`);
console.log(`  browsers (pageViews): ${top(browsers, 15)}`);
console.log("  note: 'uniqueIPs' summed across days overcounts monthly uniques; browsers Unknown/Headless/*Bot/Curl are crawlers.");

// Last 24h detail
const ld = out.lastDay?.viewer?.zones?.[0] || {};
const list = (arr, key) => (arr || []).map((x) => `${x.dimensions[key]}:${x.count}`).join(", ");
console.log("\nLAST 24H (free plan allows only a 1-day window for this detail)");
console.log(`  top 200 paths (eyeball): ${list(ld.top, "clientRequestPath")}`);
console.log(`  404 paths:               ${list(ld.notfound, "clientRequestPath")}`);
console.log(`  403 blocked paths:       ${list(ld.blocked, "clientRequestPath")}`);
console.log(`  device:                  ${list(ld.dev, "clientDeviceType")}`);
console.log(`  /api/auth/get-session by country (best human signal): ${list(ld.sess, "clientCountryName")}`);
console.log("  user agents:");
for (const x of ld.ua || []) console.log(`    ${String(x.count).padStart(5)}  ${x.dimensions.userAgent}`);

// D1
const names = Object.fromEntries((out.d1Databases || []).map((x) => [x.uuid, x.name]));
const d1 = out.d1?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups || [];
console.log("\nD1");
for (const r of d1) console.log(`  ${names[r.dimensions.databaseId] || r.dimensions.databaseId}: reads=${r.sum.readQueries} writes=${r.sum.writeQueries} rowsRead=${r.sum.rowsRead} rowsWritten=${r.sum.rowsWritten}`);
