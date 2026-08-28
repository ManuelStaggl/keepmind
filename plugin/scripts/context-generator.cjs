"use strict";var Ts=Object.create;var me=Object.defineProperty;var bs=Object.getOwnPropertyDescriptor;var hs=Object.getOwnPropertyNames;var Ss=Object.getPrototypeOf,Ns=Object.prototype.hasOwnProperty;var Ee=(s,e,t)=>()=>{if(t)throw t[0];try{return s&&(e=s(s=0)),e}catch(r){throw t=[r],r}};var mt=(s,e)=>{for(var t in e)me(s,t,{get:e[t],enumerable:!0})},Et=(s,e,t,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of hs(e))!Ns.call(s,n)&&n!==t&&me(s,n,{get:()=>e[n],enumerable:!(r=bs(e,n))||r.enumerable});return s};var ee=(s,e,t)=>(t=s!=null?Ts(Ss(s)):{},Et(e||!s||!s.__esModule?me(t,"default",{value:s,enumerable:!0}):t,s)),Rs=s=>Et(me({},"__esModule",{value:!0}),s);function Tt(s){return s.startsWith(gt)?ft+s.slice(gt.length):null}function y(s,e=process.env){let t=e[s];if(t!==void 0)return t;let r=Tt(s);return r?e[r]:void 0}function q(s,e){let t=e[s];if(t!==void 0)return t;let r=Tt(s);return r?e[r]:void 0}function bt(s){return Object.keys(s).some(e=>e.startsWith(ft))}var gt,ft,G=Ee(()=>{"use strict";gt="KEEPMIND_",ft="CLAUDE_MEM_"});function Is(){return typeof __dirname<"u"?__dirname:(0,h.dirname)((0,ht.fileURLToPath)(Ps.url))}function As(){let s=y("KEEPMIND_DATA_DIR");if(s)return s;let e=(0,h.join)((0,je.homedir)(),".keepmind"),t=(0,h.join)(e,"settings.json");try{if((0,M.existsSync)(t)){let r=JSON.parse((0,M.readFileSync)(t,"utf-8")),n=r.env??r,o=q("KEEPMIND_DATA_DIR",n);if(o)return o}}catch{}return e}function Nt(s){(0,M.mkdirSync)(s,{recursive:!0})}function xs(){try{if((0,M.existsSync)(H)||!(0,M.existsSync)(te))return(0,M.existsSync)(H);for(let s of["","-wal","-shm"]){let e=te+s,t=H+s;(0,M.existsSync)(e)&&!(0,M.existsSync)(t)&&(0,M.renameSync)(e,t)}return u.info("DB","Migrated legacy claude-mem.db to keepmind.db",{from:te,to:H}),!0}catch(s){return u.warn("DB","Could not rename legacy claude-mem.db to keepmind.db (file may be locked) \u2014 falling back to legacy path",{},s instanceof Error?s:new Error(String(s))),!1}}function re(){return xs(),!(0,M.existsSync)(H)&&(0,M.existsSync)(te)?te:H}function Rt(){return(0,h.join)(Os,"..")}var h,je,M,ht,Ps,Os,N,J,Qn,ys,Ds,Cs,vs,Ls,zn,H,te,Ms,St,Ke,Zn,eo,to,W,U=Ee(()=>{"use strict";h=require("path"),je=require("os"),M=require("fs"),ht=require("url");G();C();Ps={};Os=Is();N=As(),J=process.env.CLAUDE_CONFIG_DIR||(0,h.join)((0,je.homedir)(),".claude"),Qn=(0,h.join)(J,"plugins","marketplaces","keepmind"),ys=(0,h.join)(N,"archives"),Ds=(0,h.join)(N,"logs"),Cs=(0,h.join)(N,"trash"),vs=(0,h.join)(N,"backups"),Ls=(0,h.join)(N,"modes"),zn=(0,h.join)(N,"settings.json"),H=(0,h.join)(N,"keepmind.db"),te=(0,h.join)(N,"claude-mem.db"),Ms=(0,h.join)(N,"vector-db"),St=(0,h.join)(N,"observer-sessions"),Ke=(0,h.basename)(St),Zn=(0,h.join)(J,"settings.json"),eo=(0,h.join)(J,"commands"),to=(0,h.join)(J,"CLAUDE.md");W={dataDir:()=>N,workerPid:()=>(0,h.join)(N,"worker.pid"),workerPort:()=>(0,h.join)(N,"worker.port"),serverPid:()=>(0,h.join)(N,".server-beta.pid"),serverPort:()=>(0,h.join)(N,".server-beta.port"),serverRuntime:()=>(0,h.join)(N,".server-beta.runtime.json"),settings:()=>(0,h.join)(N,"settings.json"),database:()=>re(),chroma:()=>(0,h.join)(N,"chroma"),combinedCerts:()=>(0,h.join)(N,"combined_certs.pem"),transcriptsConfig:()=>(0,h.join)(N,"transcript-watch.json"),transcriptsState:()=>(0,h.join)(N,"transcript-watch-state.json"),corpora:()=>(0,h.join)(N,"corpora"),supervisorRegistry:()=>(0,h.join)(N,"supervisor.json"),envFile:()=>(0,h.join)(N,".env"),logsDir:()=>Ds,archives:()=>ys,trash:()=>Cs,backups:()=>vs,modes:()=>Ls,vectorDb:()=>Ms,observerSessions:()=>St}});function ks(s){return(ws??process.stderr.write.bind(process.stderr))(s)}function He(s){ks(s)}var ws,It=Ee(()=>{"use strict";ws=null});var At={};mt(At,{LogLevel:()=>ge,classifyRepeat:()=>Ot,logger:()=>u,resetLogDedupForTesting:()=>js});function js(){Q.clear()}function Ks(s,e){try{let t="";if(s){for(let r of Object.keys(s).sort())if(t+=`${r}=${String(s[r])};`,t.length>200)break}return e instanceof Error?t+=`E:${e.message}`:typeof e=="string"||typeof e=="number"||typeof e=="boolean"?t+=`D:${e}`:e&&(t+="D:obj"),t.slice(0,200)}catch{return""}}function Ot(s,e,t,r,n,o){let i=`${s}|${e}|${t}|${Ks(n,o)}`,a=Q.get(i);if(a&&r-a.windowStartedAt<Fs)return a.suppressed++,null;if(!a&&Q.size>=$s){let l=Q.keys().next();l.done||Q.delete(l.value)}let d=a?.suppressed??0,c=a?Math.round((r-a.windowStartedAt)/1e3):0;return Q.set(i,{windowStartedAt:r,suppressed:0}),d>0?` (repeated ${d}\xD7 in the previous ${c}s)`:""}var k,Ge,Us,ge,Be,Fs,$s,Q,Xe,u,C=Ee(()=>{"use strict";k=require("fs"),Ge=require("path");U();It();Us=14,ge=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(ge||{}),Be=null,Fs=6e4,$s=500,Q=new Map;Xe=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=W.logsDir();(0,k.existsSync)(e)||(0,k.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,Ge.join)(e,`keepmind-${t}.log`),this.pruneOldLogs(e)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e instanceof Error?e.message:String(e)),this.logFilePath=null}}}pruneOldLogs(e){try{let t=Date.now()-Us*24*60*60*1e3;for(let r of(0,k.readdirSync)(e)){let n=/^keepmind-(\d{4}-\d{2}-\d{2})\.log$/.exec(r);if(!n)continue;let o=Date.parse(n[1]);if(Number.isFinite(o)&&o<t)try{(0,k.unlinkSync)((0,Ge.join)(e,r))}catch{}}}catch{}}getLevel(){if(this.level===null)try{let e=W.settings();if((0,k.existsSync)(e)){let t=(0,k.readFileSync)(e,"utf-8"),n=(JSON.parse(t).KEEPMIND_LOG_LEVEL||"INFO").toUpperCase();this.level=ge[n]??1}else this.level=1}catch(e){console.error("[LOGGER] Failed to load log level from settings:",e instanceof Error?e.message:String(e)),this.level=1}return this.level}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let r=t;if(typeof t=="string")try{r=JSON.parse(t)}catch{r=t}if(e==="Bash"&&r.command)return`${e}(${r.command})`;if(r.file_path)return`${e}(${r.file_path})`;if(r.notebook_path)return`${e}(${r.notebook_path})`;if(e==="Glob"&&r.pattern)return`${e}(${r.pattern})`;if(e==="Grep"&&r.pattern)return`${e}(${r.pattern})`;if(r.url)return`${e}(${r.url})`;if(r.query)return`${e}(${r.query})`;if(e==="Task"){if(r.subagent_type)return`${e}(${r.subagent_type})`;if(r.description)return`${e}(${r.description})`}return e==="Skill"&&r.skill?`${e}(${r.skill})`:e==="LSP"&&r.operation?`${e}(${r.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${r}-${n} ${o}:${i}:${a}.${d}`}log(e,t,r,n,o){if(e<this.getLevel())return;let i="";if(process.env.KEEPMIND_LOG_DEDUP!=="0"){let S=Ot(e,t,r,Date.now(),n,o);if(S===null)return;i=S}this.ensureLogFileInitialized();let a=this.formatTimestamp(new Date),d=ge[e].padEnd(5),c=t.padEnd(6),l="";n?.correlationId?l=`[${n.correlationId}] `:n?.sessionId&&(l=`[session-${n.sessionId}] `);let _="";if(o!=null)if(o instanceof Error)_=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`;else if(this.getLevel()===0&&typeof o=="object")try{_=`
`+JSON.stringify(o,null,2)}catch{_=" "+this.formatData(o)}else _=" "+this.formatData(o);let m="";if(n){let{sessionId:S,memorySessionId:O,correlationId:T,...g}=n;Object.keys(g).length>0&&(m=` {${Object.entries(g).map(([w,R])=>`${w}=${R}`).join(", ")}}`)}let f=`[${a}] [${d}] [${c}] ${l}${r}${i}${m}${_}`;if(this.logFilePath)try{(0,k.appendFileSync)(this.logFilePath,f+`
`,"utf8")}catch(S){He(`[LOGGER] Failed to write to log file: ${S instanceof Error?S.message:String(S)}
`)}else He(f+`
`)}debug(e,t,r,n){this.log(0,e,t,r,n)}info(e,t,r,n){this.log(1,e,t,r,n)}warn(e,t,r,n){this.log(2,e,t,r,n)}setErrorSink(e){Be=e}error(e,t,r,n){this.log(3,e,t,r,n),this.routeErrorToSink(t,r,n)}routeErrorToSink(e,t,r){try{if(!Be||!(r instanceof Error))return;Be(r)}catch{}}dataIn(e,t,r,n){this.info(e,`\u2192 ${t}`,r,n)}dataOut(e,t,r,n){this.info(e,`\u2190 ${t}`,r,n)}success(e,t,r,n){this.info(e,`\u2713 ${t}`,r,n)}failure(e,t,r,n){this.error(e,`\u2717 ${t}`,r,n)}happyPathError(e,t,r,n,o=""){let c=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),l=c?`${c[1].split("/").pop()}:${c[2]}`:"unknown",_={...r,location:l};return this.warn(e,`[HAPPY-PATH] ${t}`,_,n),o}},u=new Xe});var Xn={};mt(Xn,{generateContext:()=>fs,generateContextWithStats:()=>pt});module.exports=Rs(Xn);var ms=ee(require("path"),1),Es=require("os"),gs=require("fs");var vt=require("node:sqlite");var Hs=["PRAGMA journal_mode = WAL","PRAGMA synchronous = NORMAL","PRAGMA foreign_keys = ON","PRAGMA journal_size_limit = 4194304","PRAGMA busy_timeout = 5000"];function yt(s,e){for(let t of Hs)try{s(t)}catch(r){e?e(t,r):Promise.resolve().then(()=>(C(),At)).then(({logger:n})=>{n.warn("DB","Failed to apply SQLite connection pragma",{pragma:t},r instanceof Error?r:new Error(String(r)))}).catch(()=>{})}}function Dt(s){return typeof s=="bigint"?Number(s):s}function Bs(s){return s!==null&&typeof s=="object"&&!Array.isArray(s)&&!(s instanceof Uint8Array)&&!(typeof Buffer<"u"&&Buffer.isBuffer(s))}function Ct(s){return s===void 0?null:typeof s=="boolean"?s?1:0:s}function fe(s){let e=s;if(e.length===1&&Array.isArray(e[0])&&(e=e[0]),e.length===1&&Bs(e[0])){let t=e[0],r={};for(let n of Object.keys(t))r[n]=Ct(t[n]);return[r]}return e.map(Ct)}var We=class{constructor(e){this.stmt=e}stmt;all(...e){return this.stmt.all(...fe(e))}get(...e){return this.stmt.get(...fe(e))??null}run(...e){let t=this.stmt.run(...fe(e));return{changes:Dt(t.changes),lastInsertRowid:Dt(t.lastInsertRowid)}}values(...e){return this.stmt.all(...fe(e)).map(r=>Object.values(r))}finalize(){}},se=class{db;queryCache=new Map;safeIntegers;txDepth=0;filename;constructor(e,t={}){let r=t.readonly===!0;this.safeIntegers=t.safeIntegers===!0;let n=e&&e.length>0?e:":memory:";this.filename=n,this.db=new vt.DatabaseSync(n,{readOnly:r,allowExtension:!0}),!r&&n!==":memory:"&&yt(o=>{this.db.exec(o)})}wrap(e){return this.safeIntegers&&e.setReadBigInts(!0),new We(e)}prepare(e){return this.wrap(this.db.prepare(e))}query(e){let t=this.queryCache.get(e);if(t)return t;let r=this.prepare(e);return this.queryCache.set(e,r),r}run(e,...t){return t.length===0?(this.db.exec(e),{changes:0,lastInsertRowid:0}):this.prepare(e).run(...t)}exec(e){this.db.exec(e)}loadExtension(e,t){this.db.loadExtension(e)}transaction(e){return(...t)=>{let r=this.txDepth===0,n=`__cm_sp_${this.txDepth}`;r?this.db.exec("BEGIN"):this.db.exec(`SAVEPOINT ${n}`),this.txDepth++;try{let o=e(...t);return this.txDepth--,r?this.db.exec("COMMIT"):this.db.exec(`RELEASE ${n}`),o}catch(o){throw this.txDepth--,r?this.db.exec("ROLLBACK"):(this.db.exec(`ROLLBACK TO ${n}`),this.db.exec(`RELEASE ${n}`)),o}}}close(){this.db.close()}};U();C();var Lt={injection:"injection_count",explicit_fetch:"explicit_fetch_count",fts:"fts_hit_count",vector:"vector_hit_count"};function ne(s){let e=typeof s=="string"?s.trim().toLowerCase():"";return e==="curated"||e==="observed"?e:"all"}function Te(s){return`COALESCE(${s?`${s}.`:""}source_kind, 'observed')`}function Ve(s,e){return s==="all"?null:{sql:`${Te(e)} = ?`,param:s}}var Mt=require("crypto");function Ye(s,e,t){return(0,Mt.createHash)("sha256").update([s||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function qe(s){if(!s)return[];try{let e=JSON.parse(s);return Array.isArray(e)?e:[String(e)]}catch{return[s]}}G();var Je=s=>`\xABredacted:${s}\xBB`,Gs=[{type:"PRIVATE_KEY",re:/-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,4000}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g},{type:"CONNECTION_STRING",re:/\b(?:jdbc:[a-z0-9]{1,20}:)?(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|sqlserver|oracle|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]{1,200}/gi},{type:"CREDENTIAL_ASSIGNMENT",re:/\b(?:password|pwd|passwd)\s{0,3}=\s{0,3}(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})'|([^;"'\r\n]{1,200}))/gi,group:1},{type:"AWS_KEY",re:/\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g},{type:"GITHUB_FINE_PAT",re:/\bgithub_pat_\w{82}\b/g},{type:"GITHUB_PAT",re:/\bghp_[0-9A-Za-z]{36}\b/g},{type:"GITLAB_PAT",re:/\bglpat-[\w-]{20}\b/g},{type:"SLACK_TOKEN",re:/\bxox[baprs]-[0-9A-Za-z-]{10,200}\b/g},{type:"GOOGLE_API_KEY",re:/\bAIza[\w-]{35}\b/g},{type:"STRIPE_KEY",re:/\b(?:sk|rk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}\b/g},{type:"JWT",re:/\bey[A-Za-z0-9_-]{17,500}\.ey[A-Za-z0-9_/\\-]{17,500}\.[A-Za-z0-9_/\\-]{10,500}={0,2}/g},{type:"BEARER",re:/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,500}/g},{type:"BCRYPT",re:/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g},{type:"GENERIC_SECRET",re:/(?:pass(?:word)?|secret|token|api[_-]?key|client[_-]?secret|auth)\b['"\s]{0,3}[:=>]{1,2}['"\s]{0,3}([\w./+=-]{10,150})/gi,group:1},{type:"EMAIL",category:"pii",re:/\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}\b/g},{type:"IP_ADDRESS",category:"pii",re:/\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,keep:s=>s==="0.0.0.0"||s==="255.255.255.255"||s.startsWith("127.")}];function xt(s){return s.includes("redacted:")}function Xs(s,e){if(e.re.lastIndex=0,e.group===void 0)return s.replace(e.re,r=>xt(r)||e.keep?.(r)?r:Je(e.type));let t=e.group;return s.replace(e.re,(r,...n)=>{if(e.keep?.(r))return r;let o=r,i=!1;for(let a=t-1;a<n.length;a++){let d=n[a];typeof d!="string"||d.length===0||xt(d)||(o=o.replace(d,Je(e.type)),i=!0)}return i?o:r})}function Ws(s){if(s.length===0)return 0;let e=new Map;for(let r of s)e.set(r,(e.get(r)??0)+1);let t=0;for(let r of e.values()){let n=r/s.length;t-=n*Math.log2(n)}return t}var Vs=/^[0-9a-f]+$/i;function Ys(s,e){return s.length<20||s.length>200||/[\s]/.test(s)||!/\d/.test(s)||!/[A-Za-z]/.test(s)||s.includes("/")||s.includes("\\")||s.length<=64&&Vs.test(s)||s.includes("redacted:")?!1:Ws(s)>=e}var qs=/([\s"'`,;(){}\[\]<>]+)/;function Js(s,e){let t=s.split(qs);for(let r=0;r<t.length;r++){let n=t[r];n&&Ys(n,e)&&(t[r]=Je("HIGH_ENTROPY"))}return t.join("")}function Qe(s,e={}){if(typeof s!="string"||s.length===0)return s;try{let t=s,r=e.pii!==!1;for(let n of Gs)n.category==="pii"&&!r||(t=Xs(t,n));return e.entropySweep!==!1&&(t=Js(t,e.entropyThreshold??4)),t}catch{return s}}function be(s,e={}){if(typeof s=="string")return Qe(s,e);if(Array.isArray(s))return s.map(t=>be(t,e));if(s&&typeof s=="object"){let t={};for(let[r,n]of Object.entries(s))t[r]=be(n,e);return t}return s}var Se=require("fs");U();C();G();var Ze={redactSecrets:{enabled:!0,entropyThreshold:4,entropySweep:!0,pii:!0},scoping:{enabled:!0,includeGlobal:!0,defaultSearchScope:"project"},importance:{enabled:!0,halfLifeDays:14,llmRefine:!1},injection:{tokenBudget:1e3,candidateMultiplier:3},reconcile:{enabled:!1,noopThreshold:.92,updateBand:.75,llmAdjudicate:!1,allowHardDelete:!1},supersession:{enabled:!1},expiry:{enabled:!1,ttlDays:28,importanceFloor:7,hardDelete:!1},vectorRetention:{enabled:!0,inactiveDays:90},optimizer:{enabled:!0,tickMinutes:5,vacuumHours:24}};function he(s){return!!s&&typeof s=="object"&&!Array.isArray(s)}function B(s,e){if(!he(e))return{...s};let t={...s};for(let r of Object.keys(s))e[r]!==void 0&&typeof e[r]==typeof s[r]&&(t[r]=e[r]);return t}var ze=null;function Ne(s=!1){if(ze&&!s)return ze;let e=Ze,t;try{let i=W.settings();if((0,Se.existsSync)(i)){let a=JSON.parse((0,Se.readFileSync)(i,"utf-8").replace(/^﻿/,"")),d=he(a)?a.memoryQuality??(he(a.env)?a.env.memoryQuality:void 0):void 0;he(d)&&(t=d)}}catch(i){u.debug("CONFIG","memoryQuality config load failed; using defaults",{},i instanceof Error?i:new Error(String(i)))}let r={redactSecrets:B(e.redactSecrets,t?.redactSecrets),scoping:B(e.scoping,t?.scoping),importance:B(e.importance,t?.importance),injection:B(e.injection,t?.injection),reconcile:B(e.reconcile,t?.reconcile),supersession:B(e.supersession,t?.supersession),expiry:B(e.expiry,t?.expiry),vectorRetention:B(e.vectorRetention,t?.vectorRetention),optimizer:B(e.optimizer,t?.optimizer)},n=y("KEEPMIND_REDACT_SECRETS");(n==="0"||n==="false")&&(r.redactSecrets.enabled=!1);let o=y("KEEPMIND_REDACT_PII");return(o==="0"||o==="false")&&(r.redactSecrets.pii=!1),ze=r,r}var Qs={decision:9,bugfix:8,refactor:6,discovery:5,global:7,other:3,trivial:1};function zs(s){if(Array.isArray(s))return s.length;if(typeof s=="string")try{let e=JSON.parse(s);return Array.isArray(e)?e.length:0}catch{return 0}return 0}function et(s){let e=Qs[s.type??"other"]??4;return zs(s.files_modified)>0&&(e+=1),(s.narrative?.length??0)<40&&(e-=1),/\b(TODO|FIXME|WIP)\b/i.test(s.narrative??"")&&(e-=1),Math.max(1,Math.min(10,e))}var Zs=14,en=864e5;function Pt(s,e={}){let t=e.now??Date.now(),r=(e.halfLifeDays??Zs)*en,n=(s.importance??5)/10,o=Math.max(0,t-(s.created_at_epoch??t)),i=Math.pow(.5,o/r);return n*i}function kt(s){return s.normalize("NFC").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")}var tn=new Set(["the","a","an","and","or","but","to","of","in","on","for","with","is","are","was","were","be","been","it","this","that","we","i","as","at","by","from","into","over","so","then","than","will","der","die","das","den","dem","des","ein","eine","einen","einem","einer","eines","und","oder","aber","ist","sind","war","waren","wird","werden","wurde","wurden","hat","haben","hatte","hatten","f\xFCr","mit","von","vom","zu","zum","zur","im","auf","am","an","aus","bei","nach","\xFCber","unter","durch","gegen","ohne","um","als","wie","dass","sich","es","wir","man","auch","noch","nur","schon","dann","wenn","weil","damit","sowie","bereits"].map(kt));function Re(s){return s?kt(s).replace(/[^\p{L}\p{N}\s]+/gu," ").split(/\s+/).filter(e=>e.length>0&&!tn.has(e)).join(" ").trim():""}function wt(s){let e=new Set,t=s.replace(/\s+/g," ");for(let r=0;r+3<=t.length;r++)e.add(t.slice(r,r+3));return e}function rn(s,e){let t=wt(s),r=wt(e);if(t.size===0&&r.size===0)return 1;if(t.size===0||r.size===0)return 0;let n=0;for(let o of t)r.has(o)&&n++;return n/(t.size+r.size-n)}function sn(s,e){let t=new Map,r=new Map;for(let a of s.split(" "))a&&t.set(a,(t.get(a)??0)+1);for(let a of e.split(" "))a&&r.set(a,(r.get(a)??0)+1);if(t.size===0||r.size===0)return 0;let n=0;for(let[a,d]of t)n+=d*(r.get(a)??0);let o=0;for(let a of t.values())o+=a*a;let i=0;for(let a of r.values())i+=a*a;return n/(Math.sqrt(o)*Math.sqrt(i)||1)}function nn(s,e){let t=Re(`${s??""}`),r=Re(`${e??""}`);return Math.max(rn(t,r),sn(t,r))}function Ut(s,e,t){let r=`${s.title??""} ${s.narrative??""}`,n={action:"ADD"},o=-1;for(let i of e){let a=nn(r,`${i.title??""} ${i.narrative??""}`);a<=o||(o=a,a>=t.noopThreshold?n={action:"NOOP",candidateId:i.id,score:a}:a>=t.updateBand&&t.supersessionEnabled?n={action:"UPDATE",candidateId:i.id,score:a}:n={action:"ADD",score:a})}return n}var Ft=require("crypto");function Ie(s){let e=s.title??"";if(!e){if(Array.isArray(s.facts)&&s.facts.length>0)e=s.facts[0];else if(typeof s.facts=="string")try{let r=JSON.parse(s.facts);Array.isArray(r)&&r.length>0&&(e=String(r[0]))}catch{}}e||(e=(s.narrative??"").slice(0,80));let t=Re(e);return(0,Ft.createHash)("sha1").update(t).digest("hex").slice(0,16)}var E="claude";function on(s){return s.trim().toLowerCase().replace(/\s+/g,"-")}function D(s){if(!s)return E;let e=on(s);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e:E}function $t(s){let e=["claude","codex","cursor"];return[...s].sort((t,r)=>{let n=e.indexOf(t),o=e.indexOf(r);return n!==-1||o!==-1?n===-1?1:o===-1?-1:n-o:t.localeCompare(r)})}function jt(s,e,t,r,n){let o=Date.now()-r,i=n!==void 0?"up.session_db_id = ?":"up.content_session_id = ?",a=n??e;return s.prepare(`
    SELECT
      up.*,
      s.memory_session_id,
      s.project,
      COALESCE(s.platform_source, '${E}') as platform_source
    FROM user_prompts up
    JOIN sdk_sessions s ON up.session_db_id = s.id
    WHERE ${i}
      AND up.prompt_text = ?
      AND up.created_at_epoch >= ?
    ORDER BY up.created_at_epoch DESC
    LIMIT 1
  `).get(a,t,o)??void 0}C();var Bt=["private","keepmind-context","claude-mem-context","system_instruction","system-instruction","persisted-output","system-reminder"],Kt=new RegExp(`<(${Bt.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>`,"g"),Gt=/<system-reminder>[\s\S]*?<\/system-reminder>/g,Ht=100;function an(s){let e=Object.fromEntries(Bt.map(n=>[n,0]));Kt.lastIndex=0;let t=0,r=s.replace(Kt,(n,o)=>(e[o]=(e[o]??0)+1,t+=1,""));return t>Ht&&u.warn("SYSTEM","tag count exceeds limit",void 0,{tagCount:t,maxAllowed:Ht,contentLength:s.length}),{stripped:r.trim(),counts:e}}function Xt(s){return an(s).stripped}var dn=["task-notification"],Do=new RegExp(`^\\s*<(${dn.join("|")})\\b[^>]*>(?:(?!<\\1\\b|</\\1\\b)[\\s\\S])*</\\1>\\s*$`),Co=256*1024;C();var tt=4e3;function Oe(s){let e=s.trim(),r=Xt(s).trim()||e;return r.length<=tt?r:(u.debug("DB","Truncated stored prompt text to the configured cap",{originalLength:r.length,storedLength:tt}),`${r.slice(0,tt-1)}\u2026`)}G();var V="session-checkpoint";function Wt(s){let t=(s.split(`
`).map(r=>r.trim()).find(r=>r.length>0)??"Session checkpoint").replace(/^#+\s*/,"").replace(/^\*+\s*/,"").replace(/\*+$/,"").trim();return t?t.length>80?`${t.slice(0,80).trimEnd()}\u2026`:t:"Session checkpoint"}var cn=/^0\d{3}$/,un=/^V-\d{4}$/;function ln(s){let e=s?`${s}.`:"";return`COALESCE(json_extract(${e}metadata, '$.record_id'), json_extract(${e}metadata, '$.vorgang_id'))`}var F=ln();function pn(s){let e=s.trim();return cn.test(e)?"akte":un.test(e)?"vorgang":null}function Vt(s,e){if(s)try{if(JSON.parse(s)?.kind==="vorgang")return"vorgang"}catch{}return(e&&pn(e))==="vorgang"?"vorgang":"akte"}var Yt="keepmind://curated/";var Y="revised_by";function _n(s,e){return{customTitle:s,platformSource:e?D(e):void 0}}var Ae=class{db;redactEnabled;redactOpts;mq;rt(e){return this.redactEnabled?Qe(e,this.redactOpts):e}rl(e){return this.redactEnabled?be(e,this.redactOpts):e}constructor(e=H){try{this.mq=Ne();let t=this.mq.redactSecrets;this.redactEnabled=t.enabled,this.redactOpts={entropySweep:t.entropySweep,entropyThreshold:t.entropyThreshold}}catch{this.mq=Ze,this.redactEnabled=y("KEEPMIND_REDACT_SECRETS")!=="0"&&y("KEEPMIND_REDACT_SECRETS")!=="false",this.redactOpts={entropySweep:!0,entropyThreshold:4}}if(e instanceof se)this.db=e;else{e!==":memory:"&&Nt(N);let t=e===H?re():e;this.db=new se(t)}this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.ensureMergedIntoProjectColumns(),this.addObservationSubagentColumns(),this.addObservationsUniqueContentHashIndex(),this.addObservationsMetadataColumn(),this.dropDeadPendingMessagesColumns(),this.ensurePendingMessagesToolUseIdColumn(),this.dropWorkerPidColumn(),this.ensureSDKSessionsPlatformContentIdentity(),this.ensureUserPromptsSessionDbId(),this.ensurePendingMessagesSessionToolUniqueIndex(),this.addObservationImportanceColumn(),this.addObservationBitemporalColumns(),this.addObservationLastUsedColumn(),this.addObservationUsageChannelColumns(),this.recomputeSubjectKeys(),this.addCuratedSourceColumns(),this.createDecisionEdgesTable()}createDecisionEdgesTable(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(42),t=this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_edges'").all();e&&t.length>0||(this.db.run(`
      CREATE TABLE IF NOT EXISTS decision_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        from_record TEXT NOT NULL,
        to_record TEXT NOT NULL,
        relation TEXT NOT NULL,
        certainty TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_line INTEGER NOT NULL,
        raw_text TEXT,
        created_at_epoch INTEGER NOT NULL,
        UNIQUE(project, from_record, to_record, relation, source_path, source_line)
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_edges_from ON decision_edges(project, from_record)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_edges_to ON decision_edges(project, to_record)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_edges_relation ON decision_edges(project, relation)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(42,new Date().toISOString()))}replaceEdgesForSource(e,t,r,n=Date.now()){let o=this.db.prepare("DELETE FROM decision_edges WHERE project = ? AND source_path = ?").run(e,t),i=this.db.prepare(`
      INSERT INTO decision_edges
        (project, from_record, to_record, relation, certainty, source_path, source_line, raw_text, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `),a=0;for(let d of r)i.run(e,d.from,d.to,d.relation,d.certainty,t,d.sourceLine,d.rawText??null,n),a++;return{inserted:a,removed:o?.changes??0}}getEdges(e){return this.db.prepare(`
      SELECT from_record, to_record, relation, certainty, source_path, source_line, raw_text
      FROM decision_edges WHERE project = ?
      ORDER BY from_record, to_record, relation
    `).all(e)}addCuratedSourceColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(41),t=this.db.query("PRAGMA table_info(observations)").all(),r=o=>t.some(i=>i.name===o),n=[["source_kind","TEXT"],["source_path","TEXT"],["source_line","INTEGER"],["subject","TEXT"],["last_verified_at","INTEGER"]];if(!(e&&n.every(([o])=>r(o)))){for(let[o,i]of n)r(o)||this.db.run(`ALTER TABLE observations ADD COLUMN ${o} ${i}`);this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_source_kind ON observations(project, source_kind)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_source_path ON observations(source_path)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(41,new Date().toISOString())}}addObservationUsageChannelColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(39),t=this.db.query("PRAGMA table_info(observations)").all(),r=o=>t.some(i=>i.name===o),n=["injection_count","explicit_fetch_count","fts_hit_count","vector_hit_count"];if(!(e&&n.every(r))){for(let o of n)r(o)||this.db.run(`ALTER TABLE observations ADD COLUMN ${o} INTEGER DEFAULT 0`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(39,new Date().toISOString())}}addObservationBitemporalColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(37),t=this.db.query("PRAGMA table_info(observations)").all(),r=n=>t.some(o=>o.name===n);e&&r("valid_from")&&r("valid_to")&&r("subject_key")||(r("valid_from")||this.db.run("ALTER TABLE observations ADD COLUMN valid_from INTEGER"),r("valid_to")||this.db.run("ALTER TABLE observations ADD COLUMN valid_to INTEGER"),r("subject_key")||this.db.run("ALTER TABLE observations ADD COLUMN subject_key TEXT"),this.db.run("UPDATE observations SET valid_from = created_at_epoch WHERE valid_from IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_subject_valid ON observations(project, subject_key, valid_to)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(37,new Date().toISOString()))}recomputeSubjectKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(40))return;if(this.db.query("PRAGMA table_info(observations)").all().some(r=>r.name==="subject_key")){let r=this.db.query("SELECT id, title, facts, narrative FROM observations WHERE subject_key IS NOT NULL").all(),n=this.db.prepare("UPDATE observations SET subject_key = ? WHERE id = ?"),o=0;this.db.run("BEGIN TRANSACTION");try{for(let i of r){let a=Ie({title:i.title,facts:i.facts,narrative:i.narrative});n.run(a,i.id),o++}this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK"),u.warn("DB","subject_key recompute failed \u2014 supersession may not match across the normalizer change",{rows:r.length},i instanceof Error?i:new Error(String(i)));return}o>0&&u.info("DB","Recomputed subject_key for Unicode-aware normalization",{rows:o})}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(40,new Date().toISOString())}addObservationLastUsedColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(38),r=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="last_used_at");e&&r||(r||this.db.run("ALTER TABLE observations ADD COLUMN last_used_at INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_last_used ON observations(last_used_at)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(38,new Date().toISOString()))}addObservationImportanceColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(36),r=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="importance");e&&r||(r||this.db.run("ALTER TABLE observations ADD COLUMN importance INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(36,new Date().toISOString()))}getIndexColumns(e){return this.db.query(`PRAGMA index_info(${JSON.stringify(e)})`).all().map(t=>t.name)}hasUniqueIndexOnColumns(e,t){return this.db.query(`PRAGMA index_list(${e})`).all().some(n=>{if(n.unique!==1)return!1;let o=this.getIndexColumns(n.name);return o.length===t.length&&o.every((i,a)=>i===t[a])})}resolvePromptSessionDbId(e,t,r){if(t!==void 0)return t;let n=r?D(r):void 0;return n?this.db.prepare(`
        SELECT id
        FROM sdk_sessions
        WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
          AND content_session_id = ?
        LIMIT 1
      `).get(E,n,e)?.id??null:this.db.prepare(`
      SELECT id
      FROM sdk_sessions
      WHERE content_session_id = ?
      ORDER BY CASE COALESCE(NULLIF(platform_source, ''), '${E}')
        WHEN '${E}' THEN 0
        ELSE 1
      END, id
      LIMIT 1
    `).get(e)?.id??null}dropWorkerPidColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32),r=this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="worker_pid");if(!(e&&!r)){if(r)try{this.db.run("DROP INDEX IF EXISTS idx_pending_messages_worker_pid"),this.db.run("ALTER TABLE pending_messages DROP COLUMN worker_pid"),u.debug("DB","Dropped worker_pid column and its index from pending_messages")}catch(n){u.warn("DB","Failed to drop worker_pid column from pending_messages",{},n instanceof Error?n:new Error(String(n)));return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString())}}ensureSDKSessionsPlatformContentIdentity(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33),t=this.hasUniqueIndexOnColumns("sdk_sessions",["content_session_id"]),r=this.hasUniqueIndexOnColumns("sdk_sessions",["platform_source","content_session_id"]),o=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source");if(!(e&&!t&&r&&o)){if(o||this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${E}'`),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${E}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),t){this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TABLE IF EXISTS sdk_sessions_new"),this.db.run(`
          CREATE TABLE sdk_sessions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_session_id TEXT NOT NULL,
            memory_session_id TEXT UNIQUE,
            project TEXT NOT NULL,
            platform_source TEXT NOT NULL DEFAULT '${E}',
            user_prompt TEXT,
            started_at TEXT NOT NULL,
            started_at_epoch INTEGER NOT NULL,
            completed_at TEXT,
            completed_at_epoch INTEGER,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
            worker_port INTEGER,
            prompt_counter INTEGER DEFAULT 0,
            custom_title TEXT
          )
        `),this.db.run(`
          INSERT INTO sdk_sessions_new (
            id, content_session_id, memory_session_id, project, platform_source,
            user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch,
            status, worker_port, prompt_counter, custom_title
          )
          SELECT
            id, content_session_id, memory_session_id, project,
            COALESCE(NULLIF(platform_source, ''), '${E}'),
            user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch,
            status, worker_port, prompt_counter, custom_title
          FROM sdk_sessions
        `),this.db.run("DROP TABLE sdk_sessions"),this.db.run("ALTER TABLE sdk_sessions_new RENAME TO sdk_sessions"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString()),this.db.run("COMMIT")}catch(i){throw this.db.run("ROLLBACK"),i}finally{this.db.run("PRAGMA foreign_keys = ON")}return}this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString())}}ensureUserPromptsSessionDbId(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(34);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='user_prompts'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString());return}let n=this.db.query("PRAGMA table_info(user_prompts)").all().some(c=>c.name==="session_db_id"),i=this.db.query("PRAGMA foreign_key_list(user_prompts)").all().some(c=>c.table==="sdk_sessions"&&c.from==="content_session_id");if(e&&n&&!i)return;let a=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_prompts_fts'").all().length>0,d=n?`COALESCE(up.session_db_id, (
          SELECT s.id FROM sdk_sessions s
          WHERE s.content_session_id = up.content_session_id
          ORDER BY CASE COALESCE(NULLIF(s.platform_source, ''), '${E}')
            WHEN '${E}' THEN 0
            ELSE 1
          END, s.id
          LIMIT 1
        ))`:`(
          SELECT s.id FROM sdk_sessions s
          WHERE s.content_session_id = up.content_session_id
          ORDER BY CASE COALESCE(NULLIF(s.platform_source, ''), '${E}')
            WHEN '${E}' THEN 0
            ELSE 1
          END, s.id
          LIMIT 1
        )`;this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TRIGGER IF EXISTS user_prompts_ai"),this.db.run("DROP TRIGGER IF EXISTS user_prompts_ad"),this.db.run("DROP TRIGGER IF EXISTS user_prompts_au"),this.db.run("DROP TABLE IF EXISTS user_prompts_new"),this.db.run(`
        CREATE TABLE user_prompts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_db_id INTEGER,
          content_session_id TEXT NOT NULL,
          prompt_number INTEGER NOT NULL,
          prompt_text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
        )
      `),this.db.run(`
        INSERT INTO user_prompts_new (
          id, session_db_id, content_session_id, prompt_number,
          prompt_text, created_at, created_at_epoch
        )
        SELECT
          up.id,
          ${d},
          up.content_session_id,
          up.prompt_number,
          up.prompt_text,
          up.created_at,
          up.created_at_epoch
        FROM user_prompts up
      `),this.db.run("DROP TABLE user_prompts"),this.db.run("ALTER TABLE user_prompts_new RENAME TO user_prompts"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_session ON user_prompts(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_claude_session ON user_prompts(content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_created ON user_prompts(created_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_prompt_number ON user_prompts(prompt_number)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_lookup ON user_prompts(session_db_id, prompt_number)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_user_prompts_content_lookup ON user_prompts(content_session_id, prompt_number)"),a&&(this.db.run(`
          CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
            INSERT INTO user_prompts_fts(rowid, prompt_text)
            VALUES (new.id, new.prompt_text);
          END;

          CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
            INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
            VALUES('delete', old.id, old.prompt_text);
          END;

          CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
            INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
            VALUES('delete', old.id, old.prompt_text);
            INSERT INTO user_prompts_fts(rowid, prompt_text)
            VALUES (new.id, new.prompt_text);
          END;
        `),this.db.run("INSERT INTO user_prompts_fts(user_prompts_fts) VALUES('rebuild')")),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString()),this.db.run("COMMIT")}catch(c){throw this.db.run("ROLLBACK"),c}finally{this.db.run("PRAGMA foreign_keys = ON")}}ensurePendingMessagesSessionToolUniqueIndex(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(35);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString());return}let r=this.hasUniqueIndexOnColumns("pending_messages",["session_db_id","tool_use_id"]);if(!(e&&r)){this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP INDEX IF EXISTS ux_pending_session_tool"),this.db.run(`
        DELETE FROM pending_messages
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY session_db_id, tool_use_id
                        ORDER BY CASE status
                          WHEN 'processing' THEN 0
                          WHEN 'pending' THEN 1
                          ELSE 2
                        END, id
                      ) AS duplicate_rank
                 FROM pending_messages
                WHERE tool_use_id IS NOT NULL
             )
            WHERE duplicate_rank > 1
           )
      `),this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
        ON pending_messages(session_db_id, tool_use_id)
        WHERE tool_use_id IS NOT NULL
      `),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString()),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}}}dropDeadPendingMessagesColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31),t=this.db.query("PRAGMA table_info(pending_messages)").all(),r=new Set(t.map(i=>i.name)),o=["retry_count","failed_at_epoch","completed_at_epoch"].filter(i=>r.has(i));if(!(e&&o.length===0)){if(o.length>0){this.db.run("BEGIN TRANSACTION");try{this.db.run("DELETE FROM pending_messages WHERE status NOT IN ('pending', 'processing')");for(let i of o)this.db.run(`ALTER TABLE pending_messages DROP COLUMN ${i}`),u.debug("DB",`Dropped dead column ${i} from pending_messages`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString()),this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK"),u.warn("DB","Failed to drop dead columns from pending_messages",{},i instanceof Error?i:new Error(String(i)));return}return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString())}}initializeSchema(){this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `),this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT 'claude',
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(r=>r.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),u.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),u.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(r=>r.unique===1&&r.origin!=="pk")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}u.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),u.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}u.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),u.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let r=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!r||r.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}u.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `),this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),u.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}u.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_session ON user_prompts(session_db_id);
      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(session_db_id, prompt_number);
      CREATE INDEX idx_user_prompts_content_lookup ON user_prompts(content_session_id, prompt_number);
    `);let r=`
      CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
        prompt_text,
        content='user_prompts',
        content_rowid='id'
      );
    `,n=`
      CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;

      CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
      END;

      CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;
    `;try{this.db.run(r),this.db.run(n)}catch(o){o instanceof Error?u.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},o):u.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},new Error(String(o))),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Created user_prompts table (without FTS5)");return}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}u.debug("DB","Creating pending_messages table"),this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing')),
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),u.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;u.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,r=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(l=>l.name===o);return a.some(l=>l.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),u.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(u.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};r("sdk_sessions","claude_session_id","content_session_id")&&t++,r("sdk_sessions","sdk_session_id","memory_session_id")&&t++,r("pending_messages","claude_session_id","content_session_id")&&t++,r("observations","sdk_session_id","memory_session_id")&&t++,r("session_summaries","sdk_session_id","memory_session_id")&&t++,r("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?u.debug("DB",`Successfully renamed ${t} session ID columns`):u.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),u.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21))return;u.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new");let t=this.db.query("PRAGMA table_info(observations)").all(),r=t.some(g=>g.name==="metadata"),n=t.some(g=>g.name==="content_hash"),o=r?`,
        metadata TEXT`:"",i=r?", metadata":"",a=n?`,
        content_hash TEXT`:"",d=n?", content_hash":"",c=`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL${o}${a},
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,l=`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             discovery_tokens, created_at, created_at_epoch${i}${d}
      FROM observations
    `,_=`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `,m=`
      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;
    `;this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE IF EXISTS session_summaries_new");let f=`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `,S=`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, discovery_tokens, created_at, created_at_epoch
      FROM session_summaries
    `,O=`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `,T=`
      CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;
    `;try{this.recreateObservationsWithCascade(c,l,_,m),this.recreateSessionSummariesWithCascade(f,S,O,T),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),u.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(g){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),g instanceof Error?g:new Error(String(g))}}recreateObservationsWithCascade(e,t,r,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(r),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(n)}recreateSessionSummariesWithCascade(e,t,r,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(r),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(n)}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(r=>r.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),u.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),u.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}addSessionPlatformSourceColumn(){let t=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source"),n=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(i=>i.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&t&&n||(t||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${E}'`),u.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${E}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),n||this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()))}addObservationModelColumns(){let e=this.db.query("PRAGMA table_info(observations)").all(),t=e.some(n=>n.name==="generated_by_model"),r=e.some(n=>n.name==="relevance_count");t&&r||(t||this.db.run("ALTER TABLE observations ADD COLUMN generated_by_model TEXT"),r||this.db.run("ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()))}ensureMergedIntoProjectColumns(){this.db.query("PRAGMA table_info(observations)").all().some(r=>r.name==="merged_into_project")||this.db.run("ALTER TABLE observations ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into ON observations(merged_into_project)"),this.db.query("PRAGMA table_info(session_summaries)").all().some(r=>r.name==="merged_into_project")||this.db.run("ALTER TABLE session_summaries ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into ON session_summaries(merged_into_project)")}addObservationSubagentColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27),t=this.db.query("PRAGMA table_info(observations)").all(),r=t.some(i=>i.name==="agent_type"),n=t.some(i=>i.name==="agent_id");r||this.db.run("ALTER TABLE observations ADD COLUMN agent_type TEXT"),n||this.db.run("ALTER TABLE observations ADD COLUMN agent_id TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_type ON observations(agent_type)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_id ON observations(agent_id)");let o=this.db.query("PRAGMA table_info(pending_messages)").all();if(o.length>0){let i=o.some(d=>d.name==="agent_type"),a=o.some(d=>d.name==="agent_id");i||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_type TEXT"),a||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_id TEXT")}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString())}ensurePendingMessagesToolUseIdColumn(){if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="tool_use_id")||this.db.run("ALTER TABLE pending_messages ADD COLUMN tool_use_id TEXT"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
        DELETE FROM pending_messages
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY session_db_id, tool_use_id
                        ORDER BY CASE status
                          WHEN 'processing' THEN 0
                          WHEN 'pending' THEN 1
                          ELSE 2
                        END, id
                      ) AS duplicate_rank
                 FROM pending_messages
                WHERE tool_use_id IS NOT NULL
             )
            WHERE duplicate_rank > 1
           )
      `),this.db.run(`
        -- tool_use_id is optional for summaries and legacy rows; enforce de-dupe
        -- only for rows that came from a concrete tool-use event.
        CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
        ON pending_messages(session_db_id, tool_use_id)
        WHERE tool_use_id IS NOT NULL
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString()),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}}addObservationsUniqueContentHashIndex(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29))return;let t=this.db.query("PRAGMA table_info(observations)").all(),r=t.some(o=>o.name==="memory_session_id"),n=t.some(o=>o.name==="content_hash");if(!r||!n){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString());return}this.db.run("BEGIN TRANSACTION");try{this.db.run(`
        UPDATE observations
           SET content_hash = '__null_migration_' || id || '__'
         WHERE content_hash IS NULL
      `),this.db.run(`
        DELETE FROM observations
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY memory_session_id, content_hash
                        ORDER BY id
                      ) AS duplicate_rank
                 FROM observations
             )
            WHERE duplicate_rank > 1
         )
      `),this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_session_hash
        ON observations(memory_session_id, content_hash)
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString()),this.db.run("COMMIT")}catch(o){throw this.db.run("ROLLBACK"),o}}addObservationsMetadataColumn(){this.db.query("PRAGMA table_info(observations)").all().some(r=>r.name==="metadata")||(this.db.run("ALTER TABLE observations ADD COLUMN metadata TEXT"),u.debug("DB","Added metadata column to observations table (#2116)")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString())}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}markSessionCompleted(e){let t=Date.now(),r=new Date(t).toISOString();this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(r,t,e)}ensureMemorySessionIdRegistered(e,t,r){let n=this.db.prepare(`
      SELECT id, memory_session_id, worker_port FROM sdk_sessions WHERE id = ?
    `).get(e);if(!n)throw new Error(`Session ${e} not found in sdk_sessions`);n.memory_session_id!==t&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),u.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:n.memory_session_id,newId:t})),typeof r=="number"&&n.worker_port!==r&&this.db.prepare(`
        UPDATE sdk_sessions SET worker_port = ? WHERE id = ?
      `).run(r,e)}getRecentSummaries(e,t=10){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentSummariesWithSessionInfo(e,t=3){return this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getRecentObservations(e,t=20){return this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,t)}getAllRecentObservations(e=100){return this.db.prepare(`
      SELECT
        o.id,
        o.type,
        o.title,
        o.subtitle,
        o.text,
        o.project,
        COALESCE(s.platform_source, '${E}') as platform_source,
        o.prompt_number,
        o.created_at,
        o.created_at_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      ORDER BY o.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentSummaries(e=50){return this.db.prepare(`
      SELECT
        ss.id,
        ss.request,
        ss.investigated,
        ss.learned,
        ss.completed,
        ss.next_steps,
        ss.files_read,
        ss.files_edited,
        ss.notes,
        ss.project,
        COALESCE(s.platform_source, '${E}') as platform_source,
        ss.prompt_number,
        ss.created_at,
        ss.created_at_epoch
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
      ORDER BY ss.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllRecentUserPrompts(e=100){return this.db.prepare(`
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        COALESCE(s.platform_source, '${E}') as platform_source,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      LEFT JOIN sdk_sessions s ON up.session_db_id = s.id
      ORDER BY up.created_at_epoch DESC
      LIMIT ?
    `).all(e)}getAllProjects(e){let t=e?D(e):void 0,r=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `,n=[Ke];return t&&(r+=" AND COALESCE(platform_source, ?) = ?",n.push(E,t)),r+=" ORDER BY project ASC",this.db.prepare(r).all(...n).map(i=>i.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${E}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${E}'), project
      ORDER BY latest_epoch DESC
    `).all(Ke),t=[],r=new Set,n={};for(let i of e){let a=D(i.platform_source);n[a]||(n[a]=[]),n[a].includes(i.project)||n[a].push(i.project),r.has(i.project)||(r.add(i.project),t.push(i.project))}let o=$t(Object.keys(n));return{projects:t,sources:o,projectsBySource:Object.fromEntries(o.map(i=>[i,n[i]||[]]))}}getLatestUserPrompt(e,t){let r=this.resolvePromptSessionDbId(e,t),n=r!==null?"up.session_db_id = ?":"up.content_session_id = ?",o=r!==null?r:e;return this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project,
        COALESCE(s.platform_source, '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE ${n}
      ORDER BY up.created_at_epoch DESC
      LIMIT 1
    `).get(o)}findRecentDuplicateUserPrompt(e,t,r,n){return jt(this.db,e,Oe(t),r,this.resolvePromptSessionDbId(e,n)??void 0)}getRecentSessionsWithStatus(e,t=3,r){let n=[e],o="";return r&&(o=`AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`,n.push(D(r))),n.push(t),this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project = ? AND s.memory_session_id IS NOT NULL
        ${o}
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `).all(...n)}getObservationsForSession(e,t){let r=[e],n="";return t&&(n=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions s
          WHERE s.memory_session_id = observations.memory_session_id
            AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?
        )
      `,r.push(D(t))),this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ${n}
      ORDER BY created_at_epoch ASC
    `).all(...r)}getObservationById(e,t){return t?this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      WHERE o.id = ?
        AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?
    `).get(e,D(t))||null:this.db.prepare(`
        SELECT *
        FROM observations
        WHERE id = ?
      `).get(e)||null}filterObservationIdsBySourceKind(e,t){let r=Ve(ne(t),"o");if(!r||e.length===0)return e;let n=this.db.prepare(`
      SELECT o.id FROM observations o
      WHERE o.id IN (SELECT value FROM json_each(?)) AND ${r.sql}
    `).all(JSON.stringify(e),r.param),o=new Set(n.map(i=>i.id));return e.filter(i=>o.has(i))}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:r="date_desc",limit:n,project:o,platformSource:i,type:a,concepts:d,files:c,sourceKind:l}=t,_=r==="relevance",m=_?"":`ORDER BY o.created_at_epoch ${r==="date_asc"?"ASC":"DESC"}`,f=n&&!_?`LIMIT ${n}`:"",S=e.map(()=>"?").join(","),O=[...e],T=[];o&&(T.push("o.project = ?"),O.push(o)),i&&(T.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),O.push(D(i)));let g=Ve(ne(l),"o");if(g&&(T.push(g.sql),O.push(g.param)),a)if(Array.isArray(a)){let b=a.map(()=>"?").join(",");T.push(`o.type IN (${b})`),O.push(...a)}else T.push("o.type = ?"),O.push(a);if(d){let b=Array.isArray(d)?d:[d],X=b.map(()=>"EXISTS (SELECT 1 FROM json_each(o.concepts) WHERE value = ?)");O.push(...b),T.push(`(${X.join(" OR ")})`)}if(c){let b=Array.isArray(c)?c:[c],X=b.map(()=>"(EXISTS (SELECT 1 FROM json_each(o.files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(o.files_modified) WHERE value LIKE ?))");b.forEach(_t=>{O.push(`%${_t}%`,`%${_t}%`)}),T.push(`(${X.join(" OR ")})`)}let L=T.length>0?`WHERE o.id IN (${S}) AND ${T.join(" AND ")}`:`WHERE o.id IN (${S})`,R=this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      ${L}
      ${m}
      ${f}
    `).all(...O);if(!_)return R;let v=new Map(R.map(b=>[b.id,b])),I=e.map(b=>v.get(b)).filter(b=>!!b);return n?I.slice(0,n):I}getSummaryForSession(e,t){let r=[e],n="";return t&&(n=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions sdk
          WHERE sdk.memory_session_id = session_summaries.memory_session_id
            AND COALESCE(NULLIF(sdk.platform_source, ''), '${E}') = ?
        )
      `,r.push(D(t))),this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ${n}
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(...r)||null}getFilesForSession(e){let r=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),n=new Set,o=new Set;for(let i of r)qe(i.files_read).forEach(a=>n.add(a)),qe(i.files_modified).forEach(a=>o.add(a));return{filesRead:Array.from(n),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${E}') as platform_source,
             user_prompt, custom_title, status
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getSdkSessionsBySessionIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${E}') as platform_source,
             user_prompt, custom_title,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${t})
      ORDER BY started_at_epoch DESC
    `).all(...e)}getPromptNumberFromUserPrompts(e,t){let r=this.resolvePromptSessionDbId(e,t);return r!==null?this.db.prepare(`
        SELECT COUNT(*) as count FROM user_prompts WHERE session_db_id = ?
      `).get(r).count:this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,t,r,n,o){let i=new Date,a=i.getTime(),d=_n(n,o),c=d.platformSource??E,l=this.rt(Oe(r)),_=this.db.prepare(`
      SELECT id, platform_source
      FROM sdk_sessions
      WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
        AND content_session_id = ?
    `).get(E,c,e);if(_)return t&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE id = ? AND (project IS NULL OR project = '')
        `).run(t,_.id),d.customTitle&&this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE id = ? AND custom_title IS NULL
        `).run(d.customTitle,_.id),_.id;let m=this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(e,t,c,l,d.customTitle||null,i.toISOString(),a);return Number(m.lastInsertRowid)}saveUserPrompt(e,t,r,n){let o=new Date,i=o.getTime(),a=this.rt(Oe(r)),d=this.resolvePromptSessionDbId(e,n);return this.db.prepare(`
      INSERT INTO user_prompts
      (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(d,e,t,a,o.toISOString(),i).lastInsertRowid}getUserPrompt(e,t,r){let n=this.resolvePromptSessionDbId(e,r);return n!==null?this.db.prepare(`
        SELECT prompt_text
        FROM user_prompts
        WHERE session_db_id = ? AND prompt_number = ?
        LIMIT 1
      `).get(n,t)?.prompt_text??null:this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,r,n,o=0,i,a){let d=i??Date.now(),c=new Date(d).toISOString(),l=r.source_kind==="curated",_=l&&r.type!==V,m=_?r.title:this.rt(r.title),f=_?r.subtitle:this.rt(r.subtitle),S=_?r.narrative:this.rt(r.narrative),O=_?r.facts:this.rl(r.facts),T=_?r.metadata??null:this.rt(r.metadata??null),g=Ye(e,m??null,S??null),L=et({type:r.type,narrative:S,files_modified:r.files_modified}),w;if(this.mq.reconcile.enabled&&!l){let b=this.reconcileBeforeInsert(t,r.type,m??null,S??null);if(b.action==="NOOP"&&b.candidateId){let X=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE id = ?").get(b.candidateId);if(X)return{id:X.id,createdAtEpoch:X.created_at_epoch}}else b.action==="UPDATE"&&(w=b.candidateId)}let v=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
       generated_by_model, metadata, importance, valid_from, subject_key,
       source_kind, source_path, source_line, subject, last_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_session_id, content_hash) DO NOTHING
      RETURNING id, created_at_epoch
    `).get(e,t,r.type,m,f,JSON.stringify(O),S,JSON.stringify(r.concepts),JSON.stringify(r.files_read),JSON.stringify(r.files_modified),n||null,o,r.agent_type??null,r.agent_id??null,g,c,d,a||null,T,L,d,Ie({title:m??null,facts:O,narrative:S??null}),r.source_kind??null,r.source_path??null,r.source_line??null,r.subject??null,r.last_verified_at??null);if(v)return w!==void 0&&this.mq.supersession.enabled&&this.supersedeObservation(w,v.id,d),{id:v.id,createdAtEpoch:v.created_at_epoch};let I=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?").get(e,g);if(!I)throw new Error(`storeObservation: ON CONFLICT without existing row for content_hash=${g}`);return{id:I.id,createdAtEpoch:I.created_at_epoch}}storeSummary(e,t,r,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),l=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,this.rt(r.request),this.rt(r.investigated),this.rt(r.learned),this.rt(r.completed),this.rt(r.next_steps),this.rt(r.notes),n||null,o,d,a);return{id:Number(l.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,r,n,o,i=0,a,d){let c=a??Date.now(),l=new Date(c).toISOString();return this.db.transaction(()=>{let m=[],f=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model, importance, valid_from, subject_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),S=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let T of r){let g=this.rt(T.title),L=this.rt(T.subtitle),w=this.rt(T.narrative),R=this.rl(T.facts),v=Ye(e,g??null,w??null),I=f.get(e,t,T.type,g,L,JSON.stringify(R),w,JSON.stringify(T.concepts),JSON.stringify(T.files_read),JSON.stringify(T.files_modified),o||null,i,T.agent_type??null,T.agent_id??null,v,l,c,d||null,et({type:T.type,narrative:w,files_modified:T.files_modified}),c,Ie({title:g??null,facts:R,narrative:w??null}));if(I){m.push(I.id);continue}let b=S.get(e,v);if(!b)throw new Error(`storeObservations: ON CONFLICT without existing row for content_hash=${v}`);m.push(b.id)}let O=null;if(n){let g=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,this.rt(n.request),this.rt(n.investigated),this.rt(n.learned),this.rt(n.completed),this.rt(n.next_steps),this.rt(n.notes),o||null,i,l,c);O=Number(g.lastInsertRowid)}return{observationIds:m,summaryId:O,createdAtEpoch:c}})()}markObservationsUsed(e,t="explicit_fetch",r=Date.now()){if(e.length!==0)try{let n=this.db.query("PRAGMA table_info(observations)").all(),o=f=>n.some(S=>S.name===f),i=o("last_used_at"),a=o("relevance_count"),d=Lt[t],c=o(d);if(!i&&!a&&!c)return;let l=[],_=[];i&&(l.push("last_used_at = ?"),_.push(r)),a&&l.push("relevance_count = COALESCE(relevance_count, 0) + 1"),c&&l.push(`${d} = COALESCE(${d}, 0) + 1`);let m=e.map(()=>"?").join(",");this.db.prepare(`UPDATE observations SET ${l.join(", ")} WHERE id IN (${m})`).run(..._,...e)}catch(n){u.debug("DB","markObservationsUsed failed",{count:e.length,channel:t},n instanceof Error?n:new Error(String(n)))}}evaporateScratch(e){try{let t=this.db.prepare("DELETE FROM observations WHERE memory_session_id = ? AND type = 'scratch'").run(e),r=Number(t.changes??0);return r>0&&u.info("DB","Evaporated scratch observations at SessionEnd",{memorySessionId:e,count:r}),r}catch(t){return u.warn("DB","evaporateScratch failed",{memorySessionId:e},t instanceof Error?t:new Error(String(t))),0}}evaporateAllScratch(){try{let e=this.db.prepare("DELETE FROM observations WHERE type = 'scratch'").run(),t=Number(e.changes??0);return t>0&&u.info("DB","Evaporated all scratch observations on idle shutdown",{count:t}),t}catch(e){return u.warn("DB","evaporateAllScratch failed",{},e instanceof Error?e:new Error(String(e))),0}}reconcileBeforeInsert(e,t,r,n){try{let o=Date.now()-7776e6,i=this.db.query("PRAGMA table_info(observations)").all().some(_=>_.name==="valid_to"),a=i?"AND valid_to IS NULL":"",d=this.db.prepare(`
        SELECT id, title, narrative, importance
        FROM observations
        WHERE project = ? AND type = ? AND created_at_epoch >= ? ${a}
        ORDER BY created_at_epoch DESC
        LIMIT 20
      `).all(e,t,o);if(d.length===0)return{action:"ADD"};let c=this.mq.supersession.enabled&&i;return Ut({title:r,narrative:n},d,{noopThreshold:this.mq.reconcile.noopThreshold,updateBand:this.mq.reconcile.updateBand,supersessionEnabled:c})}catch(o){return u.warn("DB","reconcileBeforeInsert failed; defaulting to ADD",{project:e,type:t},o instanceof Error?o:new Error(String(o))),{action:"ADD"}}}supersedeObservation(e,t,r){try{this.db.prepare(`
        UPDATE observations
           SET valid_to = ?,
               metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?)
         WHERE id = ? AND valid_to IS NULL
      `).run(r,t,e)}catch(n){u.warn("DB","supersedeObservation failed",{oldId:e,newId:t},n instanceof Error?n:new Error(String(n)))}}getObservationsAsOf(e,t){return this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="valid_from")?this.db.prepare(`
      SELECT * FROM observations
      WHERE project = ?
        AND COALESCE(valid_from, created_at_epoch) <= ?
        AND (valid_to IS NULL OR valid_to > ?)
    `).all(e,t,t):this.db.prepare("SELECT * FROM observations WHERE project = ?").all(e)}storeCheckpoint(e,t,r={}){let n=this.getOrCreateManualSession(e),o=Date.now(),i=r.title&&r.title.trim()?r.title.trim():Wt(t),a={checkpoint:!0};r.focus&&r.focus.trim()&&(a.focus=r.focus.trim());let d=this.storeObservation(n,e,{type:V,title:i,subtitle:"Session checkpoint",facts:[],narrative:t,concepts:[],files_read:[],files_modified:[],metadata:JSON.stringify(a),source_kind:"curated"},0,0,o,r.generatedByModel??void 0);return this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.superseded_by_checkpoint')
       WHERE id = ? AND type = ?
    `).run(d.id,V),this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by_checkpoint', ?)
       WHERE project = ? AND type = ? AND valid_to IS NULL AND id != ?
    `).run(o,d.id,e,V,d.id),u.info("DB","Saved session checkpoint",{id:d.id,project:e,title:i}),d}clearCheckpoint(e){let t=Date.now(),r=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.checkpoint_cleared', 1)
       WHERE project = ? AND type = ? AND valid_to IS NULL
    `).run(t,e,V),n=Number(r.changes??0);return u.info("DB","Cleared session checkpoint(s)",{project:e,cleared:n}),{cleared:n}}getCuratedRecord(e,t,r={}){let n=r.includeClosed?"":"AND valid_to IS NULL",o=this.db.prepare(`
      SELECT id, project, ${F} AS record_id,
             title, subtitle, narrative, metadata, source_path, source_line,
             valid_from, valid_to, created_at_epoch
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} = ?
         ${n}
       ORDER BY (valid_to IS NULL) DESC, created_at_epoch DESC, id DESC
       LIMIT 1
    `).get(e,t);return o?{...o,kind:Vt(o.metadata,o.record_id)}:null}getCuratedRelations(e,t){return this.db.prepare(`
      SELECT 'outgoing' AS direction, to_record AS other,
             relation, certainty, source_path, source_line, raw_text
        FROM decision_edges
       WHERE project = ? AND from_record = ?
      UNION ALL
      SELECT 'incoming' AS direction, from_record AS other,
             relation, certainty, source_path, source_line, raw_text
        FROM decision_edges
       WHERE project = ? AND to_record = ?
       ORDER BY direction, relation, other
    `).all(e,t,e,t)}getCuratedRevisions(e,t){return this.db.prepare(`
      SELECT id, title, narrative, metadata, valid_from, valid_to, created_at_epoch
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} = ?
       ORDER BY created_at_epoch DESC, id DESC
    `).all(e,t)}curatedProjects(){return this.db.prepare(`
      SELECT DISTINCT project FROM observations
       WHERE source_kind = 'curated' AND project IS NOT NULL AND project != ''
       ORDER BY project ASC
    `).all().map(t=>String(t.project))}settleCuratedRevisions(e,t,r,n=Date.now()){let o=this.db.prepare(`
      SELECT id, source_path FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} = ?
         AND valid_to IS NULL AND id != ?
         AND source_path LIKE '${Yt}%'
       ORDER BY id DESC LIMIT 1
    `).get(e,t,r);if(o)return this.db.prepare(`
        UPDATE observations
           SET valid_to = COALESCE(valid_to, ?),
               metadata = json_set(COALESCE(metadata, '{}'), '$.${Y}', ?)
         WHERE id = ?
      `).run(n,o.id,r),{closed:0,reactivated:!1,authoredWins:o.source_path};let i=this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.${Y}')
       WHERE id = ? AND valid_to IS NOT NULL
    `).run(r),a=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${Y}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} = ?
         AND valid_to IS NULL AND id != ?
    `).run(n,r,e,t,r);return{closed:Number(a?.changes??0),reactivated:Number(i?.changes??0)>0,authoredWins:null}}closeOtherCuratedRowsForSource(e,t,r,n=Date.now()){let o=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${Y}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND source_path = ?
         AND valid_to IS NULL AND id != ?
    `).run(n,r,e,t,r);return{closed:Number(o?.changes??0)}}refreshCuratedDerived(e,t){let r=[],n=[];t.subtitle!==void 0&&(r.push("subtitle = ?"),n.push(t.subtitle??null)),t.metadata!==void 0&&(r.push("metadata = ?"),n.push(t.metadata??null)),t.lastVerifiedAt!==void 0&&(r.push("last_verified_at = ?"),n.push(t.lastVerifiedAt??null)),r.length!==0&&(n.push(e),this.db.prepare(`UPDATE observations SET ${r.join(", ")} WHERE id = ?`).run(...n))}curatedObservationIds(e){return this.db.prepare(`
      SELECT id FROM observations
       WHERE project = ? AND source_kind = 'curated'
       ORDER BY id ASC
    `).all(e).map(r=>Number(r.id))}nextCuratedRecordId(e){let t=this.db.prepare(`
      SELECT DISTINCT ${F} AS record_id
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} IS NOT NULL
    `).all(e),r=0;for(let o of t){let i=String(o.record_id??"");if(!/^0\d{3}$/.test(i))continue;let a=parseInt(i,10);Number.isFinite(a)&&a>r&&(r=a)}let n=r+1;if(n>999)throw new Error(`curated authoring: project "${e}" has reached record 0999. The edge reader only recognises zero-padded four-digit decision numbers, so the numbering cannot continue without widening relation-lexicon/edge-reader.`);return String(n).padStart(4,"0")}storeCuratedRecord(e,t,r,n=Date.now()){let o=this.storeObservation(e,t,{type:"decision",title:r.title,subtitle:r.subtitle,facts:[],narrative:r.narrative,concepts:[],files_read:[],files_modified:[],metadata:r.metadata,source_kind:"curated",source_path:r.sourcePath,source_line:r.sourceLine,subject:r.subject,last_verified_at:r.lastVerifiedAt},0,0,n);this.db.prepare(`
      UPDATE observations
         SET valid_from = ?,
             valid_to = ?,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.${Y}')
       WHERE id = ?
    `).run(r.validFrom,r.validTo,o.id);let i=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${Y}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} = ?
         AND valid_to IS NULL AND id != ?
    `).run(n,o.id,t,r.recordId,o.id);return{...o,revisionsClosed:Number(i?.changes??0)}}closeCuratedRecord(e,t,r={}){let n=r.nowEpoch??Date.now(),o=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(
               COALESCE(metadata, '{}'),
               '$.closed_by_author', 1,
               '$.closed_reason', ?
             )
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} = ?
         AND valid_to IS NULL
    `).run(n,r.reason??null,e,t),i=Number(o?.changes??0);return u.info("DB","Closed curated record",{project:e,recordId:t,closed:i}),{closed:i}}reopenCuratedRecord(e,t){let r=this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.closed_by_author', '$.closed_reason')
       WHERE project = ? AND source_kind = 'curated'
         AND ${F} = ?
         AND json_extract(metadata, '$.closed_by_author') IS NOT NULL
    `).run(e,t);return{reopened:Number(r?.changes??0)}}getActiveCheckpoints(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, project, title, narrative, metadata, created_at, created_at_epoch
        FROM observations
       WHERE project IN (${t})
         AND type = ?
         AND valid_to IS NULL
       ORDER BY created_at_epoch DESC
    `).all(...e,V)}deleteObservationsByProject(e,t={}){let r=(e??"").trim();if(r===""||r==="*")throw new Error(`deleteObservationsByProject: refusing unsafe project '${e}'`);let n=this.db.prepare("SELECT count(*) AS c FROM observations WHERE project = ?").get(r).c,o=this.db.prepare("SELECT count(*) AS c FROM session_summaries WHERE project = ?").get(r).c,a=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_edges'").all().length>0?this.db.prepare("SELECT count(*) AS c FROM decision_edges WHERE project = ?").get(r).c:0;if(t.dryRun)return{project:r,dryRun:!0,observationsDeleted:n,summariesDeleted:o,edgesDeleted:a};this.db.transaction(()=>{this.db.prepare("DELETE FROM observations WHERE project = ?").run(r),this.db.prepare("DELETE FROM session_summaries WHERE project = ?").run(r),a>0&&this.db.prepare("DELETE FROM decision_edges WHERE project = ?").run(r)})();try{this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}catch(c){u.warn("DB","observations_fts rebuild after project delete failed",{project:r},c instanceof Error?c:new Error(String(c)))}return u.info("DB","Deleted observations by project",{project:r,observationsDeleted:n,summariesDeleted:o,edgesDeleted:a}),{project:r,dryRun:!1,observationsDeleted:n,summariesDeleted:o,edgesDeleted:a}}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:r="date_desc",limit:n,project:o,platformSource:i}=t,a=r==="relevance",d=a?"":`ORDER BY ss.created_at_epoch ${r==="date_asc"?"ASC":"DESC"}`,c=n&&!a?`LIMIT ${n}`:"",l=e.map(()=>"?").join(","),_=[...e],m=[];o&&(m.push("ss.project = ?"),_.push(o)),i&&(m.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),_.push(D(i)));let f=m.length>0?`AND ${m.join(" AND ")}`:"",O=this.db.prepare(`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON s.memory_session_id = ss.memory_session_id
      WHERE ss.id IN (${l}) ${f}
      ${d}
      ${c}
    `).all(..._);if(!a)return O;let T=new Map(O.map(L=>[L.id,L])),g=e.map(L=>T.get(L)).filter(L=>!!L);return n?g.slice(0,n):g}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:r="date_desc",limit:n,project:o,platformSource:i}=t,a=r==="relevance",d=a?"":`ORDER BY up.created_at_epoch ${r==="date_asc"?"ASC":"DESC"}`,c=n?`LIMIT ${n}`:"",l=e.map(()=>"?").join(","),_=[...e],m=[];o&&(m.push("s.project = ?"),_.push(o)),i&&(m.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),_.push(D(i)));let f=m.length>0?`AND ${m.join(" AND ")}`:"",O=this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.id IN (${l}) ${f}
      ${d}
      ${c}
    `).all(..._);if(!a)return O;let T=new Map(O.map(g=>[g.id,g]));return e.map(g=>T.get(g)).filter(g=>!!g)}getTimelineAroundTimestamp(e,t=10,r=10,n,o){return this.getTimelineAroundObservation(null,e,t,r,n,o)}getTimelineAroundObservation(e,t,r=10,n=10,o,i){let a=i?D(i):void 0,d=(R,v)=>{let I=[],b=[];return o&&(I.push(`${R}.project = ?`),b.push(o)),a&&(I.push(`COALESCE(NULLIF(${v}.platform_source, ''), '${E}') = ?`),b.push(a)),{clause:I.length>0?`AND ${I.join(" AND ")}`:"",params:b}},c=d("o","src"),l=d("ss","src"),_=d("s","s"),m,f;if(e!==null){let R=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id <= ? ${c.clause}
        ORDER BY o.id DESC
        LIMIT ?
      `,v=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id >= ? ${c.clause}
        ORDER BY o.id ASC
        LIMIT ?
      `;try{let I=this.db.prepare(R).all(e,...c.params,r+1),b=this.db.prepare(v).all(e,...c.params,n+1);if(I.length===0&&b.length===0)return{observations:[],sessions:[],prompts:[]};m=I.length>0?I[I.length-1].created_at_epoch:t,f=b.length>0?b[b.length-1].created_at_epoch:t}catch(I){return I instanceof Error?u.error("DB","Error getting boundary observations",{project:o},I):u.error("DB","Error getting boundary observations with non-Error",{},new Error(String(I))),{observations:[],sessions:[],prompts:[]}}}else{let R=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch <= ? ${c.clause}
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `,v=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch >= ? ${c.clause}
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `;try{let I=this.db.prepare(R).all(t,...c.params,r),b=this.db.prepare(v).all(t,...c.params,n+1);if(I.length===0&&b.length===0)return{observations:[],sessions:[],prompts:[]};m=I.length>0?I[I.length-1].created_at_epoch:t,f=b.length>0?b[b.length-1].created_at_epoch:t}catch(I){return I instanceof Error?u.error("DB","Error getting boundary timestamps",{project:o},I):u.error("DB","Error getting boundary timestamps with non-Error",{},new Error(String(I))),{observations:[],sessions:[],prompts:[]}}}let S=`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
      WHERE o.created_at_epoch >= ? AND o.created_at_epoch <= ? ${c.clause}
      ORDER BY o.created_at_epoch ASC
    `,O=`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions src ON src.memory_session_id = ss.memory_session_id
      WHERE ss.created_at_epoch >= ? AND ss.created_at_epoch <= ? ${l.clause}
      ORDER BY ss.created_at_epoch ASC
    `,T=`
      SELECT up.*, s.project, s.memory_session_id, COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${_.clause}
      ORDER BY up.created_at_epoch ASC
    `,g=this.db.prepare(S).all(m,f,...c.params),L=this.db.prepare(O).all(m,f,...l.params),w=this.db.prepare(T).all(m,f,..._.params);return{observations:g,sessions:L.map(R=>({id:R.id,memory_session_id:R.memory_session_id,project:R.project,request:R.request,completed:R.completed,next_steps:R.next_steps,created_at:R.created_at,created_at_epoch:R.created_at_epoch})),prompts:w.map(R=>({id:R.id,content_session_id:R.content_session_id,prompt_number:R.prompt_number,prompt_text:R.prompt_text,project:R.project,platform_source:R.platform_source,created_at:R.created_at,created_at_epoch:R.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
	      FROM user_prompts p
	      LEFT JOIN sdk_sessions s ON p.session_db_id = s.id
	      WHERE p.id = ?
      LIMIT 1
    `).get(e)||null}getPromptsByIds(e){if(e.length===0)return[];let t=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
	      FROM user_prompts p
	      LEFT JOIN sdk_sessions s ON p.session_db_id = s.id
	      WHERE p.id IN (${t})
      ORDER BY p.created_at_epoch DESC
    `).all(...e)}getOrCreateManualSession(e){let t=`manual-${e}`,r=`manual-content-${e}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(t))return t;let o=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(t,r,e,E,o.toISOString(),o.getTime()),u.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}close(){this.db.close()}importSdkSession(e){let t=D(e.platform_source),r=this.db.prepare(`SELECT id FROM sdk_sessions
       WHERE platform_source = ? AND content_session_id = ?`).get(t,e.content_session_id);return r?{imported:!1,id:r.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, platform_source, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.memory_session_id,e.project,t,e.user_prompt,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}}importSessionSummary(e){let t=this.db.prepare("SELECT id FROM session_summaries WHERE memory_session_id = ?").get(e.memory_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.request,e.investigated,e.learned,e.completed,e.next_steps,e.files_read,e.files_edited,e.notes,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importObservation(e){let t=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(e.memory_session_id,e.title,e.created_at_epoch);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, agent_type, agent_id,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.agent_type??null,e.agent_id??null,e.created_at,e.created_at_epoch).lastInsertRowid}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let t=null,r=e.platform_source?D(e.platform_source):void 0;if(typeof e.session_db_id=="number"){let a=this.db.prepare(`
        SELECT id, content_session_id, COALESCE(NULLIF(platform_source, ''), '${E}') as platform_source
        FROM sdk_sessions
        WHERE id = ?
        LIMIT 1
      `).get(e.session_db_id);a&&a.content_session_id===e.content_session_id&&(!r||D(a.platform_source)===r)&&(t=a.id)}t===null&&(t=this.resolvePromptSessionDbId(e.content_session_id,void 0,r));let n=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE ${t!==null?"session_db_id = ?":"content_session_id = ?"} AND prompt_number = ?
    `).get(t??e.content_session_id,e.prompt_number);return n?{imported:!1,id:n.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        session_db_id, content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(t,e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}};C();var Qt=require("os"),zt=ee(require("path"),1),Zt=require("child_process");C();var De=require("fs"),ye=ee(require("path"),1);C();var oe={isWorktree:!1,worktreeName:null,parentRepoPath:null,parentProjectName:null};function qt(s){let e=ye.default.join(s,".git"),t;try{t=(0,De.statSync)(e)}catch(l){return l instanceof Error&&l.code!=="ENOENT"&&u.warn("GIT","Unexpected error checking .git",{error:l instanceof Error?l.message:String(l)}),oe}if(!t.isFile())return oe;let r;try{r=(0,De.readFileSync)(e,"utf-8").trim()}catch(l){return u.warn("GIT","Failed to read .git file",{error:l instanceof Error?l.message:String(l)}),oe}let n=r.match(/^gitdir:\s*(.+)$/);if(!n)return oe;let i=n[1].match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)$/);if(!i)return oe;let a=i[1],d=ye.default.basename(s),c=ye.default.basename(a);return{isWorktree:!0,worktreeName:d,parentRepoPath:a,parentProjectName:c}}function er(s){return s==="~"||s.startsWith("~/")?s.replace(/^~/,(0,Qt.homedir)()):s}var ie=new Map,z=new Map,mn=6e4,Jt=256;function En(s,e=Date.now()){let t=ie.get(s);if(t!==void 0)return t;let r=z.get(s);if(r!==void 0&&e-r<mn)return null;let n=gn(s);if(n){if(ie.size>=Jt){let o=ie.keys().next();o.done||ie.delete(o.value)}ie.set(s,n),z.delete(s)}else{if(z.size>=Jt){let o=z.keys().next();o.done||z.delete(o.value)}z.set(s,e)}return n}function gn(s){try{return(0,Zt.execFileSync)("git",["rev-parse","--show-toplevel"],{cwd:s,encoding:"utf-8",stdio:["ignore","pipe","ignore"],windowsHide:!0}).trim()||null}catch{return null}}function fn(s){if(!s||s.trim()==="")return u.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:s}),"unknown-project";let e=er(s),r=En(e)??e,n=zt.default.basename(r);if(n===""){if(process.platform==="win32"){let i=s.match(/^([A-Z]):\\/i);if(i){let d=`drive-${i[1].toUpperCase()}`;return u.info("PROJECT_NAME","Drive root detected",{cwd:s,projectName:d}),d}}return u.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:s}),"unknown-project"}return n}function tr(s){let e=fn(s);if(!s)return{primary:e,parent:null,isWorktree:!1,allProjects:[e]};let t=er(s),r=qt(t);if(r.isWorktree&&r.parentProjectName){let n=`${r.parentProjectName}/${e}`;return{primary:n,parent:r.parentProjectName,isWorktree:!0,allProjects:[r.parentProjectName,n]}}return{primary:e,parent:null,isWorktree:!1,allProjects:[e]}}var j=require("fs"),ve=require("path"),nr=require("os");var rt={DEFAULT:3e5,HEALTH_CHECK:3e3,API_REQUEST:3e4,HOOK_READINESS_WAIT:1e4,POST_SPAWN_WAIT:15e3,READINESS_WAIT:3e4,PORT_IN_USE_WAIT:3e3,WORKER_STARTUP_WAIT:1e3,PRE_RESTART_SETTLE_DELAY:2e3,POWERSHELL_COMMAND:1e4,WINDOWS_MULTIPLIER:1.5};function rr(s){return process.platform==="win32"?Math.round(s*rt.WINDOWS_MULTIPLIER):s}var A=require("fs");var $=require("path");var sr=require("crypto");var Tn=process.platform==="win32";function bn(s){(0,A.existsSync)(s)||(0,A.mkdirSync)(s,{recursive:!0})}function ae(s,e){let t=s;try{if((0,A.lstatSync)(s).isSymbolicLink())try{t=(0,A.realpathSync)(s)}catch{let c=(0,A.readlinkSync)(s);t=(0,$.resolve)((0,$.dirname)(s),c)}}catch(c){let l=c.code;if(l!=="ENOENT"&&l!=="ENOTDIR")throw c}bn((0,$.dirname)(t));let r=(0,$.dirname)(t),n=(0,$.basename)(t),o=(0,$.join)(r,`.${n}.${process.pid}.${(0,sr.randomBytes)(6).toString("hex")}.tmp`),i=Buffer.from(JSON.stringify(e,null,2)+`
`,"utf-8"),a;try{a=(0,A.statSync)(t).mode&511}catch{}let d;try{d=a!==void 0?(0,A.openSync)(o,"w",a):(0,A.openSync)(o,"w");let c=0;for(;c<i.length;){let l=(0,A.writeSync)(d,i,c,i.length-c);if(l===0)throw new Error(`writeSync stalled at ${c}/${i.length} bytes`);c+=l}if((0,A.fsyncSync)(d),(0,A.closeSync)(d),d=void 0,(0,A.renameSync)(o,t),!Tn){let l;try{l=(0,A.openSync)(r,"r"),(0,A.fsyncSync)(l)}catch{}finally{if(l!==void 0)try{(0,A.closeSync)(l)}catch{}}}}catch(c){if(d!==void 0)try{(0,A.closeSync)(d)}catch{}try{(0,A.unlinkSync)(o)}catch{}throw c}}G();var Ce=class{static DEFAULTS={KEEPMIND_MODEL:"claude-haiku-4-5-20251001",KEEPMIND_CONTEXT_OBSERVATIONS:"50",KEEPMIND_WORKER_PORT:String(37700+(process.getuid?.()??77)%100),KEEPMIND_WORKER_HOST:"127.0.0.1",KEEPMIND_API_TIMEOUT_MS:String(rr(rt.API_REQUEST)),KEEPMIND_SKIP_TOOLS:["ListMcpResourcesTool","SlashCommand","Skill","TodoWrite","AskUserQuestion","ToolSearch","BashOutput","KillShell","EnterPlanMode","ExitPlanMode","TaskCreate","TaskUpdate","TaskList","TaskGet","TaskOutput","TaskStop","Glob","Grep"].join(","),KEEPMIND_PROVIDER:"claude",KEEPMIND_CLAUDE_AUTH_METHOD:"subscription",KEEPMIND_GEMINI_API_KEY:"",KEEPMIND_GEMINI_MODEL:"gemini-2.5-flash-lite",KEEPMIND_GEMINI_RATE_LIMITING_ENABLED:"true",KEEPMIND_GEMINI_MAX_CONTEXT_MESSAGES:"20",KEEPMIND_GEMINI_MAX_TOKENS:"100000",KEEPMIND_OPENROUTER_API_KEY:"",KEEPMIND_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",KEEPMIND_OPENROUTER_BASE_URL:"",KEEPMIND_OPENROUTER_SITE_URL:"",KEEPMIND_OPENROUTER_APP_NAME:"keepmind",KEEPMIND_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",KEEPMIND_OPENROUTER_MAX_TOKENS:"100000",KEEPMIND_DATA_DIR:(0,ve.join)((0,nr.homedir)(),".keepmind"),KEEPMIND_LOG_LEVEL:"INFO",CLAUDE_CODE_PATH:"",KEEPMIND_MODE:"code",KEEPMIND_CONTEXT_SHOW_READ_TOKENS:"false",KEEPMIND_CONTEXT_SHOW_WORK_TOKENS:"false",KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT:"true",KEEPMIND_CONTEXT_FULL_COUNT:"0",KEEPMIND_CONTEXT_FULL_FIELD:"narrative",KEEPMIND_CONTEXT_SESSION_COUNT:"5",KEEPMIND_OBSERVATION_BATCH_MAX:"8",KEEPMIND_OBSERVATION_COALESCE_MS:"2500",KEEPMIND_MAX_CONTEXT_MESSAGES:"40",KEEPMIND_OBSERVER_SESSION_MODE:"stateless",KEEPMIND_OBS_FIELD_MAX_CHARS:"2000",KEEPMIND_CAPTURE_PROFILE:"",KEEPMIND_OBSERVE_TRIGGER:"batched",KEEPMIND_ENABLED:"true",KEEPMIND_FILE_CONTEXT_ENABLED:"true",KEEPMIND_DECISION_CHECK_ENABLED:"true",KEEPMIND_DECISION_CHECK_MAX_ROWS:"3",KEEPMIND_CURATED_PROJECT:"",KEEPMIND_FILE_CONTEXT_MIN_BYTES:"1500",KEEPMIND_FILE_CONTEXT_MAX_ROWS:"3",KEEPMIND_FILE_CONTEXT_MIN_SCORE:"2",KEEPMIND_SESSION_START_INJECT:"true",KEEPMIND_SESSION_START_MAX_CHARS:"4500",KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY:"true",KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE:"false",KEEPMIND_INJECT_SOURCE_KIND:"all",KEEPMIND_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",KEEPMIND_WELCOME_HINT_ENABLED:"true",KEEPMIND_UPDATE_CHECK_ENABLED:"true",KEEPMIND_MCP_SMART_TOOLS:"false",KEEPMIND_MCP_CORPUS_TOOLS:"false",KEEPMIND_FOLDER_CLAUDEMD_ENABLED:"false",KEEPMIND_FOLDER_USE_LOCAL_MD:"false",KEEPMIND_TRANSCRIPTS_ENABLED:"true",KEEPMIND_TRANSCRIPTS_CONFIG_PATH:"",KEEPMIND_CODEX_TRANSCRIPT_INGESTION:"false",KEEPMIND_MAX_CONCURRENT_AGENTS:"2",KEEPMIND_HOOK_FAIL_LOUD_THRESHOLD:"3",KEEPMIND_EXCLUDED_PROJECTS:"",KEEPMIND_FOLDER_MD_EXCLUDE:"[]",KEEPMIND_FOLDER_MD_SKELETON_DENYLIST:"[]",KEEPMIND_SEMANTIC_INJECT:"false",KEEPMIND_SEMANTIC_INJECT_LIMIT:"5",KEEPMIND_TIER_ROUTING_ENABLED:"false",KEEPMIND_TIER_SIMPLE_MODEL:"haiku",KEEPMIND_TIER_SUMMARY_MODEL:"",KEEPMIND_TIER_FAST_MODEL:"haiku",KEEPMIND_TIER_SMART_MODEL:"sonnet",KEEPMIND_CHROMA_ENABLED:"true",KEEPMIND_TELEGRAM_ENABLED:"true",KEEPMIND_TELEGRAM_BOT_TOKEN:"",KEEPMIND_TELEGRAM_CHAT_ID:"",KEEPMIND_TELEGRAM_TRIGGER_TYPES:"security_alert",KEEPMIND_TELEGRAM_TRIGGER_CONCEPTS:"",KEEPMIND_QUEUE_ENGINE:"sqlite",KEEPMIND_REDIS_URL:"",KEEPMIND_REDIS_HOST:"127.0.0.1",KEEPMIND_REDIS_PORT:"6379",KEEPMIND_REDIS_MODE:"external",KEEPMIND_QUEUE_REDIS_PREFIX:`keepmind_${y("KEEPMIND_WORKER_PORT")??String(37700+(process.getuid?.()??77)%100)}`,KEEPMIND_AUTH_MODE:"api-key",KEEPMIND_RUNTIME:"worker",KEEPMIND_SERVER_URL:`http://127.0.0.1:${y("KEEPMIND_SERVER_PORT")??String(37877+(process.getuid?.()??77)%100)}`,KEEPMIND_SERVER_API_KEY:"",KEEPMIND_SERVER_PROJECT_ID:"",KEEPMIND_SERVER_BETA_URL:`http://127.0.0.1:${y("KEEPMIND_SERVER_PORT")??String(37877+(process.getuid?.()??77)%100)}`,KEEPMIND_SERVER_BETA_API_KEY:"",KEEPMIND_SERVER_BETA_PROJECT_ID:""};static getAllDefaults(){return{...this.DEFAULTS}}static envOverride(e){return y(e)}static get(e){return this.envOverride(e)??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let r of Object.keys(this.DEFAULTS)){let n=this.envOverride(r);n!==void 0&&(t[r]=n)}return t}static toCanonicalKeys(e){let t={};for(let[r,n]of Object.entries(e)){if(!r.startsWith("CLAUDE_MEM_")){t[r]=n;continue}let o="KEEPMIND_"+r.slice(11);e[o]===void 0&&(t[o]=n)}return t}static loadFromFile(e,t=!0){try{if(!(0,j.existsSync)(e)){let a=this.getAllDefaults();try{let d=(0,ve.dirname)(e);(0,j.existsSync)(d)||(0,j.mkdirSync)(d,{recursive:!0}),ae(e,a),console.warn("[SETTINGS] Created settings file with defaults:",e)}catch(d){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,d instanceof Error?d.message:String(d))}return t?this.applyEnvOverrides(a):a}let r=(0,j.readFileSync)(e,"utf-8"),n=JSON.parse(r.replace(/^\uFEFF/,"")),o=n;if(n.env&&typeof n.env=="object"){o=n.env;try{ae(e,o),console.warn("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(a){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,a instanceof Error?a.message:String(a))}}let i={...this.DEFAULTS};for(let a of Object.keys(this.DEFAULTS)){let d=q(a,o);d!==void 0&&(i[a]=d)}if(bt(o))try{ae(e,this.toCanonicalKeys(o)),console.warn("[SETTINGS] Migrated settings file to the KEEPMIND_* key prefix:",e)}catch(a){console.warn("[SETTINGS] Failed to migrate settings keys (legacy names still honored):",e,a instanceof Error?a.message:String(a))}return t?this.applyEnvOverrides(i):i}catch(r){console.warn("[SETTINGS] Failed to load settings, using defaults:",e,r instanceof Error?r.message:String(r));let n=this.getAllDefaults();try{if((0,j.existsSync)(e)){let o=`${e}.corrupt-${Date.now()}`;(0,j.renameSync)(e,o),console.warn("[SETTINGS] Backed up corrupt settings file to:",o)}ae(e,n),console.warn("[SETTINGS] Recovered settings file with defaults:",e)}catch(o){console.warn("[SETTINGS] Failed to recover corrupt settings file:",e,o instanceof Error?o.message:String(o))}return t?this.applyEnvOverrides(n):n}}};U();var de=require("fs"),Le=require("path");C();U();G();var x=class s{static instance=null;activeMode=null;modesDir;constructor(){let e=Rt(),t=y("KEEPMIND_MODES_DIR"),r=[...t?[t]:[],(0,Le.join)(e,"modes"),(0,Le.join)(e,"..","plugin","modes")],n=r.find(o=>(0,de.existsSync)(o));this.modesDir=n||r[0]}static getInstance(){return s.instance||(s.instance=new s),s.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let r={...e};for(let n in t){let o=t[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?r[n]=this.deepMerge(i,o):r[n]=o}return r}loadModeFile(e){let t=(0,Le.join)(this.modesDir,`${e}.json`);if(!(0,de.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let r=(0,de.readFileSync)(t,"utf-8");return JSON.parse(r)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,u.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(c=>c.id),concepts:d.observation_concepts.map(c=>c.id)}),d}catch(d){if(d instanceof Error?u.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{message:d.message}):u.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{error:String(d)}),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:r,overrideId:n}=t,o;try{o=this.loadMode(r)}catch(d){d instanceof Error?u.warn("WORKER",`Parent mode '${r}' not found for ${e}, falling back to 'code'`,{message:d.message}):u.warn("WORKER",`Parent mode '${r}' not found for ${e}, falling back to 'code'`,{error:String(d)}),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),u.debug("SYSTEM",`Loaded override file: ${n} for parent ${r}`)}catch(d){return d instanceof Error?u.warn("WORKER",`Override file '${n}' not found, using parent mode '${r}' only`,{message:d.message}):u.warn("WORKER",`Override file '${n}' not found, using parent mode '${r}' only`,{error:String(d)}),this.activeMode=o,o}if(!i)return u.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${r}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,u.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${r} + ${n})`,void 0,{parent:r,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getTypeIcon(e){return this.getObservationTypes().find(r=>r.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(r=>r.id===e)?.work_emoji||"\u{1F4DD}"}};function or(){let s=W.settings(),e=Ce.loadFromFile(s),t=x.getInstance().getActiveMode(),r=new Set(t.observation_types.map(o=>o.id)),n=new Set(t.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.KEEPMIND_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.KEEPMIND_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.KEEPMIND_CONTEXT_SESSION_COUNT,10),showReadTokens:e.KEEPMIND_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.KEEPMIND_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:r,observationConcepts:n,fullObservationField:e.KEEPMIND_CONTEXT_FULL_FIELD,showLastSummary:e.KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE==="true",injectSourceKind:ne(e.KEEPMIND_INJECT_SOURCE_KIND)}}var p={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},Me=4,st=1;function nt(s){let e=(s.title?.length||0)+(s.subtitle?.length||0)+(s.narrative?.length||0)+JSON.stringify(s.facts||[]).length;return Math.ceil(e/Me)}function ot(s){let e=s.length,t=s.reduce((i,a)=>i+nt(a),0),r=s.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=r-t,o=r>0?Math.round(n/r*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:r,savings:n,savingsPercent:o}}function hn(s){return x.getInstance().getWorkEmoji(s)}function ce(s,e){let t=nt(s),r=s.discovery_tokens||0,n=hn(s.type),o=r>0?`${n} ${r.toLocaleString("en-US")}`:"-";return{readTokens:t,discoveryTokens:r,discoveryDisplay:o,workEmoji:n}}function xe(s){return s.showReadTokens||s.showWorkTokens||s.showSavingsAmount||s.showSavingsPercent}function Sn(s){return Rn(s)}var Nn=28;function Rn(s){let e=(s.title?.length??8)+Nn;return Math.max(1,Math.ceil(e/Me))}function In(s,e){if(!Number.isFinite(e)||e<=0)return s;let t=[],r=0;for(let n of s){let o=Sn(n);r+o>e||(t.push(n),r+=o)}return t}function ir(s,e){let t=e.now??Date.now(),r=s.map(i=>({o:i,score:Pt(i,{now:t,halfLifeDays:e.halfLifeDays})})).sort((i,a)=>a.score-i.score).map(i=>i.o),n=e.maxRows>0?r.slice(0,e.maxRows):r;return In(n,e.tokenBudget).sort((i,a)=>(a.created_at_epoch??0)-(i.created_at_epoch??0))}var ar=ee(require("path"),1),Pe=require("fs");C();U();function dr(s,e,t,r){let n=Array.from(t.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(t.observationConcepts),a=i.map(()=>"?").join(",");return s.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch,
      o.importance
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE (o.project = ? OR o.merged_into_project = ? OR o.type = 'global')
      AND (o.valid_to IS NULL)
      AND (? IS NULL OR s.platform_source = ?)
      -- Origin filter (A9). The NULL folding lives in source-kind.ts: rows
      -- written before the curated path existed have source_kind NULL and must
      -- read as 'observed' rather than falling out of every filtered query.
      AND (? = 'all' OR ${Te("o")} = ?)
      AND (
        o.type = 'global'
        OR (
          type IN (${o})
          AND EXISTS (
            SELECT 1 FROM json_each(o.concepts)
            WHERE value IN (${a})
          )
        )
      )
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(e,e,r??null,r??null,t.injectSourceKind??"all",t.injectSourceKind??"all",...n,...i,t.totalObservationCount)}function cr(s,e,t,r){return s.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE (ss.project = ? OR ss.merged_into_project = ?)
      AND (? IS NULL OR s.platform_source = ?)
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(e,e,r??null,r??null,t.sessionCount+st)}function ur(s,e,t,r){let n=Array.from(t.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(t.observationConcepts),a=i.map(()=>"?").join(","),d=e.map(()=>"?").join(",");return s.db.prepare(`
    SELECT
      o.id,
      o.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      o.type,
      o.title,
      o.subtitle,
      o.narrative,
      o.facts,
      o.concepts,
      o.files_read,
      o.files_modified,
      o.discovery_tokens,
      o.created_at,
      o.created_at_epoch,
      o.project,
      o.importance
    FROM observations o
    LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
    WHERE (o.project IN (${d})
           OR o.merged_into_project IN (${d})
           OR o.type = 'global')
      AND (o.valid_to IS NULL)
      AND (? IS NULL OR s.platform_source = ?)
      -- Origin filter (A9), same clause as the single-project query above.
      AND (? = 'all' OR ${Te("o")} = ?)
      AND (
        o.type = 'global'
        OR (
          type IN (${o})
          AND EXISTS (
            SELECT 1 FROM json_each(o.concepts)
            WHERE value IN (${a})
          )
        )
      )
    ORDER BY o.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...e,r??null,r??null,t.injectSourceKind??"all",t.injectSourceKind??"all",...n,...i,t.totalObservationCount)}function lr(s,e,t,r){let n=e.map(()=>"?").join(",");return s.db.prepare(`
    SELECT
      ss.id,
      ss.memory_session_id,
      COALESCE(s.platform_source, 'claude') as platform_source,
      ss.request,
      ss.investigated,
      ss.learned,
      ss.completed,
      ss.next_steps,
      ss.created_at,
      ss.created_at_epoch,
      ss.project
    FROM session_summaries ss
    LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
    WHERE (ss.project IN (${n})
           OR ss.merged_into_project IN (${n}))
      AND (? IS NULL OR s.platform_source = ?)
    ORDER BY ss.created_at_epoch DESC
    LIMIT ?
  `).all(...e,...e,r??null,r??null,t.sessionCount+st)}function On(s){return s.replace(/[/.]/g,"-")}function An(s){if(!s.includes('"type":"assistant"'))return null;let e=JSON.parse(s);if(e.type==="assistant"&&e.message?.content&&Array.isArray(e.message.content)){let t="";for(let r of e.message.content)r.type==="text"&&(t+=r.text);if(t=t.replace(Gt,"").trim(),t)return t}return null}function yn(s){for(let e=s.length-1;e>=0;e--)try{let t=An(s[e]);if(t)return t}catch(t){t instanceof Error?u.debug("WORKER","Skipping malformed transcript line",{lineIndex:e},t):u.debug("WORKER","Skipping malformed transcript line",{lineIndex:e,error:String(t)});continue}return""}function Dn(s){try{if(!(0,Pe.existsSync)(s))return{assistantMessage:""};let e=(0,Pe.readFileSync)(s,"utf-8").trim();if(!e)return{assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim());return{assistantMessage:yn(t)}}catch(e){return e instanceof Error?u.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:s},e):u.warn("WORKER","Failed to extract prior messages from transcript",{transcriptPath:s,error:String(e)}),{assistantMessage:""}}}function pr(s,e,t,r){if(!e.showLastMessage||s.length===0)return{assistantMessage:""};let n=s.find(d=>d.memory_session_id!==t);if(!n)return{assistantMessage:""};let o=n.memory_session_id,i=On(r),a=ar.default.join(J,"projects",i,`${o}.jsonl`);return Dn(a)}function _r(s,e){let t=e[0]?.id;return s.map((r,n)=>{let o=n===0?null:e[n+1];return{...r,displayEpoch:o?o.created_at_epoch:r.created_at_epoch,displayTime:o?o.created_at:r.created_at,shouldShowLink:r.id!==t}})}function mr(s,e){let t=[...s.map(r=>({type:"observation",data:r})),...e.map(r=>({type:"summary",data:r}))];return t.sort((r,n)=>{let o=r.type==="observation"?r.data.created_at_epoch:r.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),t}function Er(s,e){return new Set(s.slice(0,e).map(t=>t.id))}function fr(){let s=new Date,e=s.toLocaleDateString("en-CA"),t=s.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),r=s.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${r}`}function Tr(s){return[`# [${s}] recent context, ${fr()}`,""]}function br(){return[`Legend: \u{1F3AF}session ${x.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function hr(s,e){let t=[],r=[`${s.totalObservations} obs (${s.totalReadTokens.toLocaleString("en-US")}t indexed)`,`${s.totalDiscoveryTokens.toLocaleString("en-US")}t work`];return s.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?r.push(`${s.savingsPercent}% savings`):e.showSavingsAmount&&r.push(`${s.savings.toLocaleString("en-US")}t saved`)),t.push(`Stats: ${r.join(" | ")}`),t.push(""),t}function it(s,e=new Date){let t=new Date(s);if(Number.isNaN(t.getTime()))return null;let r=i=>Date.UTC(i.getFullYear(),i.getMonth(),i.getDate()),n=Math.round((r(e)-r(t))/864e5);return n<=0?"today":n===1?"yesterday":n<7?`${n} days ago`:n<14?"last week":n<60?`${n} days ago`:`~${Math.round(n/30)} months ago`}function Sr(s){let e=it(s);return[e?`### ${s} (${e})`:`### ${s}`]}function Nr(s){return s.toLowerCase().replace(" am","a").replace(" pm","p")}function Rr(s,e,t){let r=s.title||"Untitled",n=x.getInstance().getTypeIcon(s.type),o=e?Nr(e):'"';return`${s.id} ${o} ${n} ${r}`}function Ir(s,e,t,r){let n=[],o=s.title||"Untitled",i=x.getInstance().getTypeIcon(s.type),a=e?Nr(e):'"',{readTokens:d,discoveryDisplay:c}=ce(s,r);n.push(`**${s.id}** ${a} ${i} **${o}**`),t&&n.push(t);let l=[];return r.showReadTokens&&l.push(`~${d}t`),r.showWorkTokens&&l.push(c),l.length>0&&n.push(l.join(" ")),n.push(""),n}function Or(s,e){return[`S${s.id} ${s.request||"Session started"} (${e})`]}var gr=200;function ue(s,e){if(!e)return[];let t=e.length>gr?`${e.slice(0,gr).trimEnd()}\u2026`:e;return[`**${s}**: ${t}`,""]}function Ar(s){return s.assistantMessage?["","---","","**Previously**","",`A: ${s.assistantMessage}`,""]:[]}function yr(s,e){return["",`Access ${Math.round(s/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function Dr(s){return`# [${s}] recent context, ${fr()}

No previous sessions found.`}function Cr(){let s=new Date,e=s.toLocaleDateString("en-CA"),t=s.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),r=s.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${r}`}function vr(s){return["",`${p.bright}${p.cyan}[${s}] recent context, ${Cr()}${p.reset}`,`${p.gray}${"\u2500".repeat(60)}${p.reset}`,""]}function Lr(){let e=x.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${p.dim}Legend: session-request | ${e}${p.reset}`,""]}function Mr(){return[`${p.bright}Column Key${p.reset}`,`${p.dim}  Read: Tokens to read this observation (cost to learn it now)${p.reset}`,`${p.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${p.reset}`,""]}function xr(){return[`${p.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${p.reset}`,"",`${p.dim}When you need implementation details, rationale, or debugging context:${p.reset}`,`${p.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${p.reset}`,`${p.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${p.reset}`,`${p.dim}  - Trust this index over re-reading code for past decisions and learnings${p.reset}`,""]}function Pr(s,e){let t=[];if(t.push(`${p.bright}${p.cyan}Context Economics${p.reset}`),t.push(`${p.dim}  Loading: ${s.totalObservations} observations (${s.totalReadTokens.toLocaleString()} tokens to read)${p.reset}`),t.push(`${p.dim}  Work investment: ${s.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${p.reset}`),s.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let r="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?r+=`${s.savings.toLocaleString()} tokens (${s.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?r+=`${s.savings.toLocaleString()} tokens`:r+=`${s.savingsPercent}% reduction from reuse`,t.push(`${p.green}${r}${p.reset}`)}return t.push(""),t}function wr(s){return[`${p.bright}${p.cyan}${s}${p.reset}`,""]}function kr(s){return[`${p.dim}${s}${p.reset}`]}function Ur(s,e,t,r){let n=s.title||"Untitled",o=x.getInstance().getTypeIcon(s.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=ce(s,r),c=t?`${p.dim}${e}${p.reset}`:" ".repeat(e.length),l=r.showReadTokens&&i>0?`${p.dim}(~${i}t)${p.reset}`:"",_=r.showWorkTokens&&a>0?`${p.dim}(${d} ${a.toLocaleString()}t)${p.reset}`:"";return`  ${p.dim}#${s.id}${p.reset}  ${c}  ${o}  ${n} ${l} ${_}`}function Fr(s,e,t,r,n){let o=[],i=s.title||"Untitled",a=x.getInstance().getTypeIcon(s.type),{readTokens:d,discoveryTokens:c,workEmoji:l}=ce(s,n),_=t?`${p.dim}${e}${p.reset}`:" ".repeat(e.length),m=n.showReadTokens&&d>0?`${p.dim}(~${d}t)${p.reset}`:"",f=n.showWorkTokens&&c>0?`${p.dim}(${l} ${c.toLocaleString()}t)${p.reset}`:"";return o.push(`  ${p.dim}#${s.id}${p.reset}  ${_}  ${a}  ${p.bright}${i}${p.reset}`),r&&o.push(`    ${p.dim}${r}${p.reset}`),(m||f)&&o.push(`    ${m} ${f}`),o.push(""),o}function $r(s,e){let t=`${s.request||"Session started"} (${e})`;return[`${p.yellow}#S${s.id}${p.reset} ${t}`,""]}function le(s,e,t){return e?[`${t}${s}:${p.reset} ${e}`,""]:[]}function jr(s){return s.assistantMessage?["","---","",`${p.bright}${p.magenta}Previously${p.reset}`,"",`${p.dim}A: ${s.assistantMessage}${p.reset}`,""]:[]}function Kr(s,e){let t=Math.round(s/1e3);return["",`${p.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use get_observations([IDs]) or the mem-search skill.${p.reset}`]}function Hr(s){return`
${p.bright}${p.cyan}[${s}] recent context, ${Cr()}${p.reset}
${p.gray}${"\u2500".repeat(60)}${p.reset}

${p.dim}No previous sessions found for this project yet.${p.reset}
`}function Br(s,e,t,r){let n=[];return r?n.push(...vr(s)):n.push(...Tr(s)),r?n.push(...Lr()):n.push(...br()),r&&(n.push(...Mr()),n.push(...xr())),xe(t)&&(r?n.push(...Pr(e,t)):n.push(...hr(e,t))),n}function Gr(s){if(!s||s.length===0)return[];let e=[];for(let t of s){let r=(t.created_at??"").slice(0,10),n=it(r),o=n?`${r} \xB7 ${n}`:r,i=null;try{let a=t.metadata?JSON.parse(t.metadata):null;a&&typeof a.focus=="string"&&a.focus.trim()&&(i=a.focus.trim())}catch{}e.push(`# \u23F3 CHECKPOINT \u2014 ${t.project} (${o})`),e.push("Curated hand-off from the previous session. Resume from here before anything else."),i&&e.push(`_Focus: ${i}_`),e.push(""),t.narrative&&t.narrative.trim()&&(e.push(t.narrative.trim()),e.push("")),e.push("---"),e.push("")}return e}var P=require("node:fs"),at=require("node:path");U();C();var Cn="curated-import-state.json",pe=1;function vn(s){return(0,at.join)(s,Cn)}function Ln(s){let e=vn(s);if(!(0,P.existsSync)(e))return{version:pe,projects:{}};try{let t=JSON.parse((0,P.readFileSync)(e,"utf8"));return t?.version!==pe?{version:pe,projects:{}}:{version:pe,projects:t.projects??{}}}catch(t){return u.warn("DB","Curated import state unreadable \u2014 treating as absent",{path:e},t instanceof Error?t:void 0),{version:pe,projects:{}}}}function Xr(s=N){return Object.values(Ln(s).projects)}function Mn(s){let e=0,t=0,r=[s];for(;r.length>0;){let n=r.pop(),o;try{o=(0,P.readdirSync)(n,{withFileTypes:!0}),t=Math.max(t,(0,P.statSync)(n).mtimeMs)}catch{continue}for(let i of o){let a=(0,at.join)(n,i.name);if(i.isDirectory()){r.push(a);continue}if(i.isFile()){e+=1;try{t=Math.max(t,(0,P.statSync)(a).mtimeMs)}catch{}}}}return{files:e,newest:t}}function Wr(s){return s.map(e=>{let t=!1;try{t=(0,P.statSync)(e.path).isDirectory()}catch{t=!1}if(!t)return{path:e.path,kind:e.kind,files:0,newestMtimeEpoch:0,present:!1};let{files:r,newest:n}=Mn(e.path);return{path:e.path,kind:e.kind,files:r,newestMtimeEpoch:Math.round(n),present:!0}})}function Vr(s,e){if(!s||s.lastSuccessEpoch===null)return{stale:!0,reason:"never imported successfully"};if(!s.indexed)return{stale:!0,reason:"the last import did not get as far as verifying the semantic index"};let t=new Map(s.sources.map(r=>[r.path,r]));for(let r of e){let n=t.get(r.path);if(!n)return{stale:!0,reason:`a source was added: ${r.path}`};if(!r.present)return{stale:!0,reason:`a source is missing: ${r.path}`};if(r.files!==n.files)return{stale:!0,reason:`${r.path} holds ${r.files} file(s), ${n.files} at the last import`};if(r.newestMtimeEpoch>n.newestMtimeEpoch)return{stale:!0,reason:`${r.path} was changed after the last import`}}for(let r of s.sources)if(!e.some(n=>n.path===r.path))return{stale:!0,reason:`a source was removed from the configuration: ${r.path}`};return{stale:!1,reason:null}}var K=require("node:fs"),Ue=require("node:path");U();var ct=require("node:path");C();G();var qr="settings.json",Yr="curatedSources",_e="KEEPMIND_CURATED_SOURCES";function dt(s,e){if(!Array.isArray(s))return e.push({entry:s,reason:`expected an array, got ${typeof s}`}),[];let t=[];for(let r of s){if(typeof r!="object"||r===null){e.push({entry:r,reason:"not an object"});continue}let n=r,o=n.path,i=n.kind;if(typeof o!="string"||o.trim().length===0){e.push({entry:r,reason:"missing `path`"});continue}if(i!=="akten"&&i!=="vorgaenge"){e.push({entry:r,reason:`\`kind\` must be "akten" or "vorgaenge", got ${JSON.stringify(i)}`});continue}if(!(0,Ue.isAbsolute)(o)){e.push({entry:r,reason:`\`path\` must be absolute: ${o}`});continue}let a=n.project;if(a!==void 0&&(typeof a!="string"||a.trim().length===0)){e.push({entry:r,reason:`\`project\` must be a non-empty string when given, got ${JSON.stringify(a)}`});continue}t.push({path:(0,Ue.resolve)(o),kind:i,...a?{project:a.trim()}:{}})}return t}function Jr(s,e){let t=new Map;for(let r of s){let n=r.project??e;if(!n)throw new Error(`Curated source "${r.path}" names no project and no fallback project was resolved`);let o=t.get(n);o?o.push(r):t.set(n,[r])}return t}function Qr(s=N){let e=[],t=process.env[_e];if(t&&t.trim().length>0){let n=t.trim();try{return n.startsWith("[")?{sources:dt(JSON.parse(n),e),origin:`${_e} (inline)`,rejected:e}:(0,K.existsSync)(n)?{sources:dt(JSON.parse((0,K.readFileSync)(n,"utf8")),e),origin:n,rejected:e}:(e.push({entry:n,reason:`${_e} is neither JSON nor an existing file`}),{sources:[],origin:_e,rejected:e})}catch(o){return e.push({entry:n,reason:`unreadable: ${o instanceof Error?o.message:o}`}),{sources:[],origin:_e,rejected:e}}}let r=(0,ct.join)(s,qr);if(!(0,K.existsSync)(r))return{sources:[],origin:r,rejected:e};try{let n=JSON.parse((0,K.readFileSync)(r,"utf8"));return Yr in n?{sources:dt(n[Yr],e),origin:r,rejected:e}:{sources:[],origin:r,rejected:e}}catch(n){return u.warn("DB","Could not read curated source set",{settingsPath:r},n instanceof Error?n:void 0),e.push({entry:r,reason:`unreadable: ${n instanceof Error?n.message:n}`}),{sources:[],origin:r,rejected:e}}}function zr(s=N){let e=y("KEEPMIND_CURATED_PROJECT");if(e&&e.trim().length>0)return e.trim();let t=(0,ct.join)(s,qr);if(!(0,K.existsSync)(t))return null;try{let r=JSON.parse((0,K.readFileSync)(t,"utf8")),n=r.env??r,o=q("KEEPMIND_CURATED_PROJECT",n);return typeof o=="string"&&o.trim().length>0?o.trim():null}catch{return null}}function Zr(s){return s.filter(e=>{try{return!(0,K.statSync)(e.path).isDirectory()}catch{return!0}})}U();function es(s=N,e={}){let t=new Map;for(let a of Xr(s))t.set(a.project,a);let r=Qr(s),n=new Map;if(r.sources.length>0){let a=r.sources.filter(c=>c.project);for(let[c,l]of Jr(a,"(unattributed)"))c!=="(unattributed)"&&n.set(c,l);let d=r.sources.filter(c=>!c.project);if(d.length>0){let c=zr(s),l=c?[c]:t.size>0?[...t.keys()]:[];for(let _ of l)n.set(_,[...n.get(_)??[],...d]);l.length===0&&n.set("(no project configured)",d)}}let o=new Set([...t.keys(),...n.keys()]),i=[];for(let a of o){let d=t.get(a)??null,c=n.get(a)??[],l=c.length>0?Vr(d,Wr(c)):{stale:d===null||d.lastSuccessEpoch===null,reason:d?null:"never imported"},_=Zr(c),m=e.storedRecords?e.storedRecords.get(a)??0:null,f=xn(c,_,m);i.push({project:a,lastSuccessEpoch:d?.lastSuccessEpoch??null,lastAttemptEpoch:d?.lastAttemptEpoch??0,records:d?.records??0,edges:d?.edges??0,indexed:d?.indexed??!1,failure:d?.failure??null,stale:l.stale,staleReason:l.reason,ok:d!==null&&d.lastSuccessEpoch!==null&&d.indexed&&!d.failure&&!l.stale,sources:c,absentSources:_,storedRecords:m,presence:f})}return i.sort((a,d)=>a.project.localeCompare(d.project))}function xn(s,e,t){return s.length===0||e.length===0||e.length<s.length?"present":t===null?"unknown":t>0?"detached":"absent"}function Pn(s,e=Date.now()){if(s.lastSuccessEpoch===null)return"never";let t=new Date(s.lastSuccessEpoch).toISOString().slice(0,10),r=Math.floor((e-s.lastSuccessEpoch)/864e5);return r<=0?`${t} \xB7 today`:r===1?`${t} \xB7 yesterday`:`${t} \xB7 ${r} days ago`}function Z(s,e=Date.now()){let t=Pn(s,e);if(s.ok)return`last imported ${t} \xB7 ${s.records} record(s), ${s.edges} relation(s) \xB7 index in sync`;if(s.presence==="detached")return`${s.storedRecords??0} record(s) held here, searchable \xB7 sources not reachable from this machine (${s.absentSources.map(o=>o.path).join(", ")}) \u2014 nothing refreshes them here`;if(s.presence==="absent")return"configured for a corpus this machine does not have";let r=new Set;return s.lastSuccessEpoch===null&&r.add("never imported successfully"),s.failure&&r.add(s.failure),s.indexed||r.add("the last import did not get as far as verifying the semantic index"),s.stale&&s.staleReason&&r.add(s.staleReason),`last imported ${t} \u2014 ${[...r].join("; ")}`}var ts=require("node:fs"),rs=require("node:sqlite");U();C();function ss(s=re()){if(!(0,ts.existsSync)(s))return null;let e=null;try{e=new rs.DatabaseSync(s,{readOnly:!0});let t=e.prepare(`
      SELECT project, COUNT(*) AS n
        FROM observations
       WHERE source_kind = 'curated' AND project IS NOT NULL AND project != ''
       GROUP BY project
    `).all();return new Map(t.map(r=>[String(r.project),Number(r.n)]))}catch(t){return u.debug("DB","Curated record counts could not be read",{},t instanceof Error?t:void 0),null}finally{try{e?.close()}catch{}}}C();function ns(s={}){let e=s.now??Date.now(),t;try{t=s.entries??es(void 0,{storedRecords:ss()})}catch(c){return u.debug("WORKER","Curated health could not be read",{},c instanceof Error?c:void 0),[]}if(t.length===0)return[];if(t=t.filter(c=>c.presence!=="absent"),t.length===0)return[];let r=t.filter(c=>c.presence==="detached"),n=t.filter(c=>c.presence!=="detached"),o=r.map(c=>`Curated corpus [${c.project}]: ${Z(c,e)}`);if(n.length===0)return[...o,""];t=n;let i=t.filter(c=>!c.ok),a=[];if(i.length===0){for(let c of t)a.push(`Curated corpus [${c.project}]: ${Z(c,e)}`);return a.push(...o),a.push(""),a}a.push("# \u26A0 CURATED CORPUS OUT OF STEP"),a.push("The lasting entries below are not in step with their source files. Answers drawn from them may be out of date."),a.push("");for(let c of i)a.push(`- **${c.project}** \u2014 ${Z(c,e)}`);let d=t.filter(c=>c.ok);for(let c of d)a.push(`- ${c.project} \u2014 ${Z(c,e)}`);for(let c of r)a.push(`- ${c.project} \u2014 ${Z(c,e)}`);return a.push(""),a.push("Fix it with `npx keepmind curated:import` (add `--project <name>`), then `npx keepmind doctor`."),a.push(""),a.push("---"),a.push(""),a}var Fe=ee(require("path"),1);C();function $e(s){if(!s)return[];try{let e=JSON.parse(s);return Array.isArray(e)?e:[]}catch(e){return u.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:s?.substring(0,50)},e instanceof Error?e:new Error(String(e))),[]}}function ut(s){return new Date(s).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function lt(s){return new Date(s).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function is(s){return new Date(s).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function os(s,e){return Fe.default.isAbsolute(s)?Fe.default.relative(e,s).split(Fe.default.sep).join("/"):s}function as(s,e,t){let r=$e(s);if(r.length>0)return os(r[0],e);if(t){let n=$e(t);if(n.length>0)return os(n[0],e)}return"General"}function wn(s){let e=new Map;for(let r of s){let n=r.type==="observation"?r.data.created_at:r.data.displayTime,o=is(n);e.has(o)||e.set(o,[]),e.get(o).push(r)}let t=Array.from(e.entries()).sort((r,n)=>{let o=new Date(r[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(t)}function ds(s,e){return e.fullObservationField==="narrative"?s.narrative:s.facts?$e(s.facts).join(`
`):null}function kn(s,e,t,r){let n=[];n.push(...Sr(s));let o="";for(let i of e)if(i.type==="summary"){let a=i.data,d=ut(a.displayTime);n.push(...Or(a,d))}else{let a=i.data,d=lt(a.created_at),l=d!==o?d:"";if(o=d,t.has(a.id)){let m=ds(a,r);n.push(...Ir(a,l,m,r))}else n.push(Rr(a,l,r))}return n}function Un(s,e,t,r,n){let o=[];o.push(...wr(s));let i=null,a="";for(let d of e)if(d.type==="summary"){i=null,a="";let c=d.data,l=ut(c.displayTime);o.push(...$r(c,l))}else{let c=d.data,l=as(c.files_modified,n,c.files_read),_=lt(c.created_at),m=_!==a;a=_;let f=t.has(c.id);if(l!==i&&(o.push(...kr(l)),i=l),f){let S=ds(c,r);o.push(...Fr(c,_,m,S,r))}else o.push(Ur(c,_,m,r))}return o.push(""),o}function Fn(s,e,t,r,n,o){return o?Un(s,e,t,r,n):kn(s,e,t,r)}function cs(s,e,t,r,n){let o=[],i=wn(s);for(let[a,d]of i)o.push(...Fn(a,d,e,t,r,n));return o}function us(s,e,t){return!(!s.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function ls(s,e){let t=[];return e?(t.push(...le("Investigated",s.investigated,p.blue)),t.push(...le("Learned",s.learned,p.yellow)),t.push(...le("Completed",s.completed,p.green)),t.push(...le("Next Steps",s.next_steps,p.magenta))):(t.push(...ue("Investigated",s.investigated)),t.push(...ue("Learned",s.learned)),t.push(...ue("Completed",s.completed)),t.push(...ue("Next Steps",s.next_steps))),t}function ps(s,e){return e?jr(s):Ar(s)}function _s(s,e,t){return!xe(e)||s.totalDiscoveryTokens<=0||s.savings<=0?[]:t?Kr(s.totalDiscoveryTokens,s.totalReadTokens):yr(s.totalDiscoveryTokens,s.totalReadTokens)}var $n=ms.default.join((0,Es.homedir)(),".claude","plugins","marketplaces","keepmind","plugin",".install-version");function jn(){try{return new Ae}catch(s){if(s instanceof Error&&s.code==="ERR_DLOPEN_FAILED"){try{(0,gs.unlinkSync)($n)}catch(e){e instanceof Error?u.debug("WORKER","Marker file cleanup failed (may not exist)",{},e):u.debug("WORKER","Marker file cleanup failed (may not exist)",{error:String(e)})}return u.error("WORKER","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw s}}function Kn(s,e){return e?Hr(s):Dr(s)}function Hn(s,e,t,r,n,o,i,a){let d=[],c=ot(e);d.push(...Br(s,c,n,a)),d.push(...ns()),d.push(...Gr(r));let l=t.slice(0,n.sessionCount),_=_r(l,t),m=mr(e,_),f=Er(e,n.fullObservationCount);d.push(...cs(m,f,n,o,a));let S=t[0],O=e[0];us(n,S,O)&&d.push(...ls(S,a));let T=pr(e,n,i,o);return d.push(...ps(T,a)),d.push(..._s(c,n,a)),d.join(`
`).trimEnd()}var Bn=new Set(["bugfix","discovery","decision","refactor","security_alert","security_note"]);function Gn(s,e,t){let r=ot(s),n={bugfix:0,discovery:0,decision:0,refactor:0,security_alert:0,security_note:0,other:0},o=new Set,i=Number.POSITIVE_INFINITY;for(let d of s){let c=Bn.has(d.type)?d.type:"other";n[c]++,d.memory_session_id&&o.add(d.memory_session_id),d.created_at_epoch&&d.created_at_epoch<i&&(i=d.created_at_epoch)}let a=Number.isFinite(i)?Math.max(0,Math.floor((Date.now()-i)/864e5)):0;return{observation_count:s.length,session_count:o.size,timeline_depth_days:a,has_session_summary:e.length>0,obs_type_bugfix:n.bugfix,obs_type_discovery:n.discovery,obs_type_decision:n.decision,obs_type_refactor:n.refactor,obs_type_security_alert:n.security_alert,obs_type_security_note:n.security_note,obs_type_other:n.other,tokens_injected:r.totalReadTokens,tokens_saved_vs_naive:r.savings,search_strategy:t?"full":"timeline"}}async function pt(s,e=!1){let t=or(),r=Ne(),n=s?.cwd??process.cwd(),o=tr(n),i=s?.projects?.length?s.projects:o.allProjects,a=i[i.length-1]??o.primary,d=r.importance.enabled&&!s?.full,c=t.totalObservationCount;d&&(t.totalObservationCount=Math.max(c,c*Math.max(1,r.injection.candidateMultiplier))),s?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let l=jn();if(!l)return{text:"",stats:null};try{let _=s?.platformSource?D(s.platformSource):void 0,m=i.length>1?ur(l,i,t,_):dr(l,a,t,_),f=d?ir(m,{tokenBudget:r.injection.tokenBudget,halfLifeDays:r.importance.halfLifeDays,maxRows:c}):m,S=i.length>1?lr(l,i,t,_):cr(l,a,t,_),O=l.getActiveCheckpoints(i);return f.length>0&&l.markObservationsUsed(f.map(g=>g.id),"injection"),f.length===0&&S.length===0&&O.length===0?{text:Kn(a,e),stats:null}:{text:Hn(a,f,S,O,t,n,s?.session_id,e),stats:Gn(f,S,!!s?.full)}}finally{l.close()}}async function fs(s,e=!1){return(await pt(s,e)).text}0&&(module.exports={generateContext,generateContextWithStats});
