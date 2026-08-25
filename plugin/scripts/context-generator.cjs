"use strict";var zs=Object.create;var ae=Object.defineProperty;var Zs=Object.getOwnPropertyDescriptor;var er=Object.getOwnPropertyNames;var tr=Object.getPrototypeOf,sr=Object.prototype.hasOwnProperty;var rr=(r,e)=>{for(var s in e)ae(r,s,{get:e[s],enumerable:!0})},ot=(r,e,s,t)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of er(e))!sr.call(r,n)&&n!==s&&ae(r,n,{get:()=>e[n],enumerable:!(t=Zs(e,n))||t.enumerable});return r};var V=(r,e,s)=>(s=r!=null?zs(tr(r)):{},ot(e||!r||!r.__esModule?ae(s,"default",{value:r,enumerable:!0}):s,r)),nr=r=>ot(ae({},"__esModule",{value:!0}),r);var yn={};rr(yn,{generateContext:()=>Qs,generateContextWithStats:()=>nt});module.exports=nr(yn);var Ys=V(require("path"),1),qs=require("os"),Js=require("fs");var dt=require("node:sqlite");function it(r){return typeof r=="bigint"?Number(r):r}function or(r){return r!==null&&typeof r=="object"&&!Array.isArray(r)&&!(r instanceof Uint8Array)&&!(typeof Buffer<"u"&&Buffer.isBuffer(r))}function at(r){return r===void 0?null:typeof r=="boolean"?r?1:0:r}function de(r){let e=r;if(e.length===1&&Array.isArray(e[0])&&(e=e[0]),e.length===1&&or(e[0])){let s=e[0],t={};for(let n of Object.keys(s))t[n]=at(s[n]);return[t]}return e.map(at)}var ve=class{constructor(e){this.stmt=e}stmt;all(...e){return this.stmt.all(...de(e))}get(...e){return this.stmt.get(...de(e))??null}run(...e){let s=this.stmt.run(...de(e));return{changes:it(s.changes),lastInsertRowid:it(s.lastInsertRowid)}}values(...e){return this.stmt.all(...de(e)).map(t=>Object.values(t))}finalize(){}},Y=class{db;queryCache=new Map;safeIntegers;txDepth=0;filename;constructor(e,s={}){let t=s.readonly===!0;this.safeIntegers=s.safeIntegers===!0;let n=e&&e.length>0?e:":memory:";if(this.filename=n,this.db=new dt.DatabaseSync(n,{readOnly:t,allowExtension:!0}),!t&&n!==":memory:")try{this.db.exec("PRAGMA journal_mode=WAL")}catch{}}wrap(e){return this.safeIntegers&&e.setReadBigInts(!0),new ve(e)}prepare(e){return this.wrap(this.db.prepare(e))}query(e){let s=this.queryCache.get(e);if(s)return s;let t=this.prepare(e);return this.queryCache.set(e,t),t}run(e,...s){return s.length===0?(this.db.exec(e),{changes:0,lastInsertRowid:0}):this.prepare(e).run(...s)}exec(e){this.db.exec(e)}loadExtension(e,s){this.db.loadExtension(e)}transaction(e){return(...s)=>{let t=this.txDepth===0,n=`__cm_sp_${this.txDepth}`;t?this.db.exec("BEGIN"):this.db.exec(`SAVEPOINT ${n}`),this.txDepth++;try{let o=e(...s);return this.txDepth--,t?this.db.exec("COMMIT"):this.db.exec(`RELEASE ${n}`),o}catch(o){throw this.txDepth--,t?this.db.exec("ROLLBACK"):(this.db.exec(`ROLLBACK TO ${n}`),this.db.exec(`RELEASE ${n}`)),o}}}close(){this.db.close()}};var b=require("path"),ke=require("os"),L=require("fs");var _t=require("url");var ct="KEEPMIND_",ut="CLAUDE_MEM_";function lt(r){return r.startsWith(ct)?ut+r.slice(ct.length):null}function D(r,e=process.env){let s=e[r];if(s!==void 0)return s;let t=lt(r);return t?e[t]:void 0}function G(r,e){let s=e[r];if(s!==void 0)return s;let t=lt(r);return t?e[t]:void 0}function pt(r){return Object.keys(r).some(e=>e.startsWith(ut))}var P=require("fs"),xe=require("path");var ir=null;function ar(r){return(ir??process.stderr.write.bind(process.stderr))(r)}function Le(r){ar(r)}var dr=14,Pe=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(Pe||{}),Me=null,cr=6e4,ur=500,q=new Map;function lr(r,e){try{let s="";if(r){for(let t of Object.keys(r).sort())if(s+=`${t}=${String(r[t])};`,s.length>200)break}return e instanceof Error?s+=`E:${e.message}`:typeof e=="string"||typeof e=="number"||typeof e=="boolean"?s+=`D:${e}`:e&&(s+="D:obj"),s.slice(0,200)}catch{return""}}function pr(r,e,s,t,n,o){let i=`${r}|${e}|${s}|${lr(n,o)}`,a=q.get(i);if(a&&t-a.windowStartedAt<cr)return a.suppressed++,null;if(!a&&q.size>=ur){let l=q.keys().next();l.done||q.delete(l.value)}let d=a?.suppressed??0,c=a?Math.round((t-a.windowStartedAt)/1e3):0;return q.set(i,{windowStartedAt:t,suppressed:0}),d>0?` (repeated ${d}\xD7 in the previous ${c}s)`:""}var we=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=K.logsDir();(0,P.existsSync)(e)||(0,P.mkdirSync)(e,{recursive:!0});let s=new Date().toISOString().split("T")[0];this.logFilePath=(0,xe.join)(e,`keepmind-${s}.log`),this.pruneOldLogs(e)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e instanceof Error?e.message:String(e)),this.logFilePath=null}}}pruneOldLogs(e){try{let s=Date.now()-dr*24*60*60*1e3;for(let t of(0,P.readdirSync)(e)){let n=/^keepmind-(\d{4}-\d{2}-\d{2})\.log$/.exec(t);if(!n)continue;let o=Date.parse(n[1]);if(Number.isFinite(o)&&o<s)try{(0,P.unlinkSync)((0,xe.join)(e,t))}catch{}}}catch{}}getLevel(){if(this.level===null)try{let e=K.settings();if((0,P.existsSync)(e)){let s=(0,P.readFileSync)(e,"utf-8"),n=(JSON.parse(s).KEEPMIND_LOG_LEVEL||"INFO").toUpperCase();this.level=Pe[n]??1}else this.level=1}catch(e){console.error("[LOGGER] Failed to load log level from settings:",e instanceof Error?e.message:String(e)),this.level=1}return this.level}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let s=Object.keys(e);return s.length===0?"{}":s.length<=3?JSON.stringify(e):`{${s.length} keys: ${s.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,s){if(!s)return e;let t=s;if(typeof s=="string")try{t=JSON.parse(s)}catch{t=s}if(e==="Bash"&&t.command)return`${e}(${t.command})`;if(t.file_path)return`${e}(${t.file_path})`;if(t.notebook_path)return`${e}(${t.notebook_path})`;if(e==="Glob"&&t.pattern)return`${e}(${t.pattern})`;if(e==="Grep"&&t.pattern)return`${e}(${t.pattern})`;if(t.url)return`${e}(${t.url})`;if(t.query)return`${e}(${t.query})`;if(e==="Task"){if(t.subagent_type)return`${e}(${t.subagent_type})`;if(t.description)return`${e}(${t.description})`}return e==="Skill"&&t.skill?`${e}(${t.skill})`:e==="LSP"&&t.operation?`${e}(${t.operation})`:e}formatTimestamp(e){let s=e.getFullYear(),t=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${s}-${t}-${n} ${o}:${i}:${a}.${d}`}log(e,s,t,n,o){if(e<this.getLevel())return;let i="";if(process.env.KEEPMIND_LOG_DEDUP!=="0"){let f=pr(e,s,t,Date.now(),n,o);if(f===null)return;i=f}this.ensureLogFileInitialized();let a=this.formatTimestamp(new Date),d=Pe[e].padEnd(5),c=s.padEnd(6),l="";n?.correlationId?l=`[${n.correlationId}] `:n?.sessionId&&(l=`[session-${n.sessionId}] `);let _="";if(o!=null)if(o instanceof Error)_=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`;else if(this.getLevel()===0&&typeof o=="object")try{_=`
`+JSON.stringify(o,null,2)}catch{_=" "+this.formatData(o)}else _=" "+this.formatData(o);let m="";if(n){let{sessionId:f,memorySessionId:R,correlationId:O,...h}=n;Object.keys(h).length>0&&(m=` {${Object.entries(h).map(([w,T])=>`${w}=${T}`).join(", ")}}`)}let g=`[${a}] [${d}] [${c}] ${l}${t}${i}${m}${_}`;if(this.logFilePath)try{(0,P.appendFileSync)(this.logFilePath,g+`
`,"utf8")}catch(f){Le(`[LOGGER] Failed to write to log file: ${f instanceof Error?f.message:String(f)}
`)}else Le(g+`
`)}debug(e,s,t,n){this.log(0,e,s,t,n)}info(e,s,t,n){this.log(1,e,s,t,n)}warn(e,s,t,n){this.log(2,e,s,t,n)}setErrorSink(e){Me=e}error(e,s,t,n){this.log(3,e,s,t,n),this.routeErrorToSink(s,t,n)}routeErrorToSink(e,s,t){try{if(!Me||!(t instanceof Error))return;Me(t)}catch{}}dataIn(e,s,t,n){this.info(e,`\u2192 ${s}`,t,n)}dataOut(e,s,t,n){this.info(e,`\u2190 ${s}`,t,n)}success(e,s,t,n){this.info(e,`\u2713 ${s}`,t,n)}failure(e,s,t,n){this.error(e,`\u2717 ${s}`,t,n)}happyPathError(e,s,t,n,o=""){let c=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),l=c?`${c[1].split("/").pop()}:${c[2]}`:"unknown",_={...t,location:l};return this.warn(e,`[HAPPY-PATH] ${s}`,_,n),o}},u=new we;var Rr={};function _r(){return typeof __dirname<"u"?__dirname:(0,b.dirname)((0,_t.fileURLToPath)(Rr.url))}var mr=_r();function Er(){let r=D("KEEPMIND_DATA_DIR");if(r)return r;let e=(0,b.join)((0,ke.homedir)(),".keepmind"),s=(0,b.join)(e,"settings.json");try{if((0,L.existsSync)(s)){let t=JSON.parse((0,L.readFileSync)(s,"utf-8")),n=t.env??t,o=G("KEEPMIND_DATA_DIR",n);if(o)return o}}catch{}return e}var N=Er(),B=process.env.CLAUDE_CONFIG_DIR||(0,b.join)((0,ke.homedir)(),".claude"),Fn=(0,b.join)(B,"plugins","marketplaces","keepmind"),gr=(0,b.join)(N,"archives"),fr=(0,b.join)(N,"logs"),Tr=(0,b.join)(N,"trash"),br=(0,b.join)(N,"backups"),hr=(0,b.join)(N,"modes"),$n=(0,b.join)(N,"settings.json"),$=(0,b.join)(N,"keepmind.db"),J=(0,b.join)(N,"claude-mem.db"),Sr=(0,b.join)(N,"vector-db"),mt=(0,b.join)(N,"observer-sessions"),Ue=(0,b.basename)(mt),jn=(0,b.join)(B,"settings.json"),Hn=(0,b.join)(B,"commands"),Kn=(0,b.join)(B,"CLAUDE.md");function Et(r){(0,L.mkdirSync)(r,{recursive:!0})}function Nr(){try{if((0,L.existsSync)($)||!(0,L.existsSync)(J))return(0,L.existsSync)($);for(let r of["","-wal","-shm"]){let e=J+r,s=$+r;(0,L.existsSync)(e)&&!(0,L.existsSync)(s)&&(0,L.renameSync)(e,s)}return u.info("DB","Migrated legacy claude-mem.db to keepmind.db",{from:J,to:$}),!0}catch(r){return u.warn("DB","Could not rename legacy claude-mem.db to keepmind.db (file may be locked) \u2014 falling back to legacy path",{},r instanceof Error?r:new Error(String(r))),!1}}function Fe(){return Nr(),!(0,L.existsSync)($)&&(0,L.existsSync)(J)?J:$}function gt(){return(0,b.join)(mr,"..")}var K={dataDir:()=>N,workerPid:()=>(0,b.join)(N,"worker.pid"),workerPort:()=>(0,b.join)(N,"worker.port"),serverPid:()=>(0,b.join)(N,".server-beta.pid"),serverPort:()=>(0,b.join)(N,".server-beta.port"),serverRuntime:()=>(0,b.join)(N,".server-beta.runtime.json"),settings:()=>(0,b.join)(N,"settings.json"),database:()=>Fe(),chroma:()=>(0,b.join)(N,"chroma"),combinedCerts:()=>(0,b.join)(N,"combined_certs.pem"),transcriptsConfig:()=>(0,b.join)(N,"transcript-watch.json"),transcriptsState:()=>(0,b.join)(N,"transcript-watch-state.json"),corpora:()=>(0,b.join)(N,"corpora"),supervisorRegistry:()=>(0,b.join)(N,"supervisor.json"),envFile:()=>(0,b.join)(N,".env"),logsDir:()=>fr,archives:()=>gr,trash:()=>Tr,backups:()=>br,modes:()=>hr,vectorDb:()=>Sr,observerSessions:()=>mt};var ft={injection:"injection_count",explicit_fetch:"explicit_fetch_count",fts:"fts_hit_count",vector:"vector_hit_count"};var Tt=require("crypto");function $e(r,e,s){return(0,Tt.createHash)("sha256").update([r||"",e||"",s||""].join("\0")).digest("hex").slice(0,16)}function je(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[String(e)]}catch{return[r]}}var He=r=>`\xABredacted:${r}\xBB`,Ir=[{type:"PRIVATE_KEY",re:/-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,4000}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g},{type:"CONNECTION_STRING",re:/\b(?:jdbc:[a-z0-9]{1,20}:)?(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|sqlserver|oracle|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]{1,200}/gi},{type:"CREDENTIAL_ASSIGNMENT",re:/\b(?:password|pwd|passwd)\s{0,3}=\s{0,3}(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})'|([^;"'\r\n]{1,200}))/gi,group:1},{type:"AWS_KEY",re:/\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g},{type:"GITHUB_FINE_PAT",re:/\bgithub_pat_\w{82}\b/g},{type:"GITHUB_PAT",re:/\bghp_[0-9A-Za-z]{36}\b/g},{type:"GITLAB_PAT",re:/\bglpat-[\w-]{20}\b/g},{type:"SLACK_TOKEN",re:/\bxox[baprs]-[0-9A-Za-z-]{10,200}\b/g},{type:"GOOGLE_API_KEY",re:/\bAIza[\w-]{35}\b/g},{type:"STRIPE_KEY",re:/\b(?:sk|rk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}\b/g},{type:"JWT",re:/\bey[A-Za-z0-9_-]{17,500}\.ey[A-Za-z0-9_/\\-]{17,500}\.[A-Za-z0-9_/\\-]{10,500}={0,2}/g},{type:"BEARER",re:/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,500}/g},{type:"BCRYPT",re:/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g},{type:"GENERIC_SECRET",re:/(?:pass(?:word)?|secret|token|api[_-]?key|client[_-]?secret|auth)\b['"\s]{0,3}[:=>]{1,2}['"\s]{0,3}([\w./+=-]{10,150})/gi,group:1},{type:"EMAIL",category:"pii",re:/\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}\b/g},{type:"IP_ADDRESS",category:"pii",re:/\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,keep:r=>r==="0.0.0.0"||r==="255.255.255.255"||r.startsWith("127.")}];function bt(r){return r.includes("redacted:")}function Or(r,e){if(e.re.lastIndex=0,e.group===void 0)return r.replace(e.re,t=>bt(t)||e.keep?.(t)?t:He(e.type));let s=e.group;return r.replace(e.re,(t,...n)=>{if(e.keep?.(t))return t;let o=t,i=!1;for(let a=s-1;a<n.length;a++){let d=n[a];typeof d!="string"||d.length===0||bt(d)||(o=o.replace(d,He(e.type)),i=!0)}return i?o:t})}function Ar(r){if(r.length===0)return 0;let e=new Map;for(let t of r)e.set(t,(e.get(t)??0)+1);let s=0;for(let t of e.values()){let n=t/r.length;s-=n*Math.log2(n)}return s}var yr=/^[0-9a-f]+$/i;function Dr(r,e){return r.length<20||r.length>200||/[\s]/.test(r)||!/\d/.test(r)||!/[A-Za-z]/.test(r)||r.includes("/")||r.includes("\\")||r.length<=64&&yr.test(r)||r.includes("redacted:")?!1:Ar(r)>=e}var Cr=/([\s"'`,;(){}\[\]<>]+)/;function vr(r,e){let s=r.split(Cr);for(let t=0;t<s.length;t++){let n=s[t];n&&Dr(n,e)&&(s[t]=He("HIGH_ENTROPY"))}return s.join("")}function Ke(r,e={}){if(typeof r!="string"||r.length===0)return r;try{let s=r,t=e.pii!==!1;for(let n of Ir)n.category==="pii"&&!t||(s=Or(s,n));return e.entropySweep!==!1&&(s=vr(s,e.entropyThreshold??4)),s}catch{return r}}function ce(r,e={}){if(typeof r=="string")return Ke(r,e);if(Array.isArray(r))return r.map(s=>ce(s,e));if(r&&typeof r=="object"){let s={};for(let[t,n]of Object.entries(r))s[t]=ce(n,e);return s}return r}var le=require("fs");var Be={redactSecrets:{enabled:!0,entropyThreshold:4,entropySweep:!0,pii:!0},scoping:{enabled:!0,includeGlobal:!0,defaultSearchScope:"project"},importance:{enabled:!0,halfLifeDays:14,llmRefine:!1},injection:{tokenBudget:1e3,candidateMultiplier:3},reconcile:{enabled:!1,noopThreshold:.92,updateBand:.75,llmAdjudicate:!1,allowHardDelete:!1},supersession:{enabled:!1},expiry:{enabled:!1,ttlDays:28,importanceFloor:7,hardDelete:!1},vectorRetention:{enabled:!0,inactiveDays:90},optimizer:{enabled:!0,tickMinutes:5,vacuumHours:24}};function ue(r){return!!r&&typeof r=="object"&&!Array.isArray(r)}function j(r,e){if(!ue(e))return{...r};let s={...r};for(let t of Object.keys(r))e[t]!==void 0&&typeof e[t]==typeof r[t]&&(s[t]=e[t]);return s}var Ge=null;function pe(r=!1){if(Ge&&!r)return Ge;let e=Be,s;try{let i=K.settings();if((0,le.existsSync)(i)){let a=JSON.parse((0,le.readFileSync)(i,"utf-8").replace(/^﻿/,"")),d=ue(a)?a.memoryQuality??(ue(a.env)?a.env.memoryQuality:void 0):void 0;ue(d)&&(s=d)}}catch(i){u.debug("CONFIG","memoryQuality config load failed; using defaults",{},i instanceof Error?i:new Error(String(i)))}let t={redactSecrets:j(e.redactSecrets,s?.redactSecrets),scoping:j(e.scoping,s?.scoping),importance:j(e.importance,s?.importance),injection:j(e.injection,s?.injection),reconcile:j(e.reconcile,s?.reconcile),supersession:j(e.supersession,s?.supersession),expiry:j(e.expiry,s?.expiry),vectorRetention:j(e.vectorRetention,s?.vectorRetention),optimizer:j(e.optimizer,s?.optimizer)},n=D("KEEPMIND_REDACT_SECRETS");(n==="0"||n==="false")&&(t.redactSecrets.enabled=!1);let o=D("KEEPMIND_REDACT_PII");return(o==="0"||o==="false")&&(t.redactSecrets.pii=!1),Ge=t,t}var Lr={decision:9,bugfix:8,refactor:6,discovery:5,global:7,other:3,trivial:1};function Mr(r){if(Array.isArray(r))return r.length;if(typeof r=="string")try{let e=JSON.parse(r);return Array.isArray(e)?e.length:0}catch{return 0}return 0}function Xe(r){let e=Lr[r.type??"other"]??4;return Mr(r.files_modified)>0&&(e+=1),(r.narrative?.length??0)<40&&(e-=1),/\b(TODO|FIXME|WIP)\b/i.test(r.narrative??"")&&(e-=1),Math.max(1,Math.min(10,e))}var xr=14,Pr=864e5;function ht(r,e={}){let s=e.now??Date.now(),t=(e.halfLifeDays??xr)*Pr,n=(r.importance??5)/10,o=Math.max(0,s-(r.created_at_epoch??s)),i=Math.pow(.5,o/t);return n*i}function Nt(r){return r.normalize("NFC").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")}var wr=new Set(["the","a","an","and","or","but","to","of","in","on","for","with","is","are","was","were","be","been","it","this","that","we","i","as","at","by","from","into","over","so","then","than","will","der","die","das","den","dem","des","ein","eine","einen","einem","einer","eines","und","oder","aber","ist","sind","war","waren","wird","werden","wurde","wurden","hat","haben","hatte","hatten","f\xFCr","mit","von","vom","zu","zum","zur","im","auf","am","an","aus","bei","nach","\xFCber","unter","durch","gegen","ohne","um","als","wie","dass","sich","es","wir","man","auch","noch","nur","schon","dann","wenn","weil","damit","sowie","bereits"].map(Nt));function _e(r){return r?Nt(r).replace(/[^\p{L}\p{N}\s]+/gu," ").split(/\s+/).filter(e=>e.length>0&&!wr.has(e)).join(" ").trim():""}function St(r){let e=new Set,s=r.replace(/\s+/g," ");for(let t=0;t+3<=s.length;t++)e.add(s.slice(t,t+3));return e}function kr(r,e){let s=St(r),t=St(e);if(s.size===0&&t.size===0)return 1;if(s.size===0||t.size===0)return 0;let n=0;for(let o of s)t.has(o)&&n++;return n/(s.size+t.size-n)}function Ur(r,e){let s=new Map,t=new Map;for(let a of r.split(" "))a&&s.set(a,(s.get(a)??0)+1);for(let a of e.split(" "))a&&t.set(a,(t.get(a)??0)+1);if(s.size===0||t.size===0)return 0;let n=0;for(let[a,d]of s)n+=d*(t.get(a)??0);let o=0;for(let a of s.values())o+=a*a;let i=0;for(let a of t.values())i+=a*a;return n/(Math.sqrt(o)*Math.sqrt(i)||1)}function Fr(r,e){let s=_e(`${r??""}`),t=_e(`${e??""}`);return Math.max(kr(s,t),Ur(s,t))}function Rt(r,e,s){let t=`${r.title??""} ${r.narrative??""}`,n={action:"ADD"},o=-1;for(let i of e){let a=Fr(t,`${i.title??""} ${i.narrative??""}`);a<=o||(o=a,a>=s.noopThreshold?n={action:"NOOP",candidateId:i.id,score:a}:a>=s.updateBand&&s.supersessionEnabled?n={action:"UPDATE",candidateId:i.id,score:a}:n={action:"ADD",score:a})}return n}var It=require("crypto");function me(r){let e=r.title??"";if(!e){if(Array.isArray(r.facts)&&r.facts.length>0)e=r.facts[0];else if(typeof r.facts=="string")try{let t=JSON.parse(r.facts);Array.isArray(t)&&t.length>0&&(e=String(t[0]))}catch{}}e||(e=(r.narrative??"").slice(0,80));let s=_e(e);return(0,It.createHash)("sha1").update(s).digest("hex").slice(0,16)}var E="claude";function $r(r){return r.trim().toLowerCase().replace(/\s+/g,"-")}function C(r){if(!r)return E;let e=$r(r);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e:E}function Ot(r){let e=["claude","codex","cursor"];return[...r].sort((s,t)=>{let n=e.indexOf(s),o=e.indexOf(t);return n!==-1||o!==-1?n===-1?1:o===-1?-1:n-o:s.localeCompare(t)})}function At(r,e,s,t,n){let o=Date.now()-t,i=n!==void 0?"up.session_db_id = ?":"up.content_session_id = ?",a=n??e;return r.prepare(`
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
  `).get(a,s,o)??void 0}var Ct=["private","keepmind-context","claude-mem-context","system_instruction","system-instruction","persisted-output","system-reminder"],yt=new RegExp(`<(${Ct.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>`,"g"),vt=/<system-reminder>[\s\S]*?<\/system-reminder>/g,Dt=100;function jr(r){let e=Object.fromEntries(Ct.map(n=>[n,0]));yt.lastIndex=0;let s=0,t=r.replace(yt,(n,o)=>(e[o]=(e[o]??0)+1,s+=1,""));return s>Dt&&u.warn("SYSTEM","tag count exceeds limit",void 0,{tagCount:s,maxAllowed:Dt,contentLength:r.length}),{stripped:t.trim(),counts:e}}function Lt(r){return jr(r).stripped}var Hr=["task-notification"],ao=new RegExp(`^\\s*<(${Hr.join("|")})\\b[^>]*>(?:(?!<\\1\\b|</\\1\\b)[\\s\\S])*</\\1>\\s*$`),co=256*1024;var We=4e3;function Ee(r){let e=r.trim(),t=Lt(r).trim()||e;return t.length<=We?t:(u.debug("DB","Truncated stored prompt text to the configured cap",{originalLength:t.length,storedLength:We}),`${t.slice(0,We-1)}\u2026`)}var X="session-checkpoint";function Mt(r){let s=(r.split(`
`).map(t=>t.trim()).find(t=>t.length>0)??"Session checkpoint").replace(/^#+\s*/,"").replace(/^\*+\s*/,"").replace(/\*+$/,"").trim();return s?s.length>80?`${s.slice(0,80).trimEnd()}\u2026`:s:"Session checkpoint"}var Kr=/^0\d{3}$/,Gr=/^V-\d{4}$/;function Br(r){let e=r?`${r}.`:"";return`COALESCE(json_extract(${e}metadata, '$.record_id'), json_extract(${e}metadata, '$.vorgang_id'))`}var k=Br();function Xr(r){let e=r.trim();return Kr.test(e)?"akte":Gr.test(e)?"vorgang":null}function xt(r,e){if(r)try{if(JSON.parse(r)?.kind==="vorgang")return"vorgang"}catch{}return(e&&Xr(e))==="vorgang"?"vorgang":"akte"}function Yr(r,e){return{customTitle:r,platformSource:e?C(e):void 0}}var ge=class r{db;redactEnabled;redactOpts;mq;rt(e){return this.redactEnabled?Ke(e,this.redactOpts):e}rl(e){return this.redactEnabled?ce(e,this.redactOpts):e}constructor(e=$){try{this.mq=pe();let s=this.mq.redactSecrets;this.redactEnabled=s.enabled,this.redactOpts={entropySweep:s.entropySweep,entropyThreshold:s.entropyThreshold}}catch{this.mq=Be,this.redactEnabled=D("KEEPMIND_REDACT_SECRETS")!=="0"&&D("KEEPMIND_REDACT_SECRETS")!=="false",this.redactOpts={entropySweep:!0,entropyThreshold:4}}if(e instanceof Y)this.db=e;else{e!==":memory:"&&Et(N);let s=e===$?Fe():e;this.db=new Y(s),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.db.run(`PRAGMA journal_size_limit = ${4194304}`),this.db.run(`PRAGMA busy_timeout = ${5e3}`)}this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.ensureMergedIntoProjectColumns(),this.addObservationSubagentColumns(),this.addObservationsUniqueContentHashIndex(),this.addObservationsMetadataColumn(),this.dropDeadPendingMessagesColumns(),this.ensurePendingMessagesToolUseIdColumn(),this.dropWorkerPidColumn(),this.ensureSDKSessionsPlatformContentIdentity(),this.ensureUserPromptsSessionDbId(),this.ensurePendingMessagesSessionToolUniqueIndex(),this.addObservationImportanceColumn(),this.addObservationBitemporalColumns(),this.addObservationLastUsedColumn(),this.addObservationUsageChannelColumns(),this.recomputeSubjectKeys(),this.addCuratedSourceColumns(),this.createDecisionEdgesTable()}createDecisionEdgesTable(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(42),s=this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_edges'").all();e&&s.length>0||(this.db.run(`
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
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_edges_from ON decision_edges(project, from_record)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_edges_to ON decision_edges(project, to_record)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_edges_relation ON decision_edges(project, relation)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(42,new Date().toISOString()))}replaceEdgesForSource(e,s,t,n=Date.now()){let o=this.db.prepare("DELETE FROM decision_edges WHERE project = ? AND source_path = ?").run(e,s),i=this.db.prepare(`
      INSERT INTO decision_edges
        (project, from_record, to_record, relation, certainty, source_path, source_line, raw_text, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `),a=0;for(let d of t)i.run(e,d.from,d.to,d.relation,d.certainty,s,d.sourceLine,d.rawText??null,n),a++;return{inserted:a,removed:o?.changes??0}}getEdges(e){return this.db.prepare(`
      SELECT from_record, to_record, relation, certainty, source_path, source_line, raw_text
      FROM decision_edges WHERE project = ?
      ORDER BY from_record, to_record, relation
    `).all(e)}addCuratedSourceColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(41),s=this.db.query("PRAGMA table_info(observations)").all(),t=o=>s.some(i=>i.name===o),n=[["source_kind","TEXT"],["source_path","TEXT"],["source_line","INTEGER"],["subject","TEXT"],["last_verified_at","INTEGER"]];if(!(e&&n.every(([o])=>t(o)))){for(let[o,i]of n)t(o)||this.db.run(`ALTER TABLE observations ADD COLUMN ${o} ${i}`);this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_source_kind ON observations(project, source_kind)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_source_path ON observations(source_path)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(41,new Date().toISOString())}}addObservationUsageChannelColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(39),s=this.db.query("PRAGMA table_info(observations)").all(),t=o=>s.some(i=>i.name===o),n=["injection_count","explicit_fetch_count","fts_hit_count","vector_hit_count"];if(!(e&&n.every(t))){for(let o of n)t(o)||this.db.run(`ALTER TABLE observations ADD COLUMN ${o} INTEGER DEFAULT 0`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(39,new Date().toISOString())}}addObservationBitemporalColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(37),s=this.db.query("PRAGMA table_info(observations)").all(),t=n=>s.some(o=>o.name===n);e&&t("valid_from")&&t("valid_to")&&t("subject_key")||(t("valid_from")||this.db.run("ALTER TABLE observations ADD COLUMN valid_from INTEGER"),t("valid_to")||this.db.run("ALTER TABLE observations ADD COLUMN valid_to INTEGER"),t("subject_key")||this.db.run("ALTER TABLE observations ADD COLUMN subject_key TEXT"),this.db.run("UPDATE observations SET valid_from = created_at_epoch WHERE valid_from IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_subject_valid ON observations(project, subject_key, valid_to)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(37,new Date().toISOString()))}recomputeSubjectKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(40))return;if(this.db.query("PRAGMA table_info(observations)").all().some(t=>t.name==="subject_key")){let t=this.db.query("SELECT id, title, facts, narrative FROM observations WHERE subject_key IS NOT NULL").all(),n=this.db.prepare("UPDATE observations SET subject_key = ? WHERE id = ?"),o=0;this.db.run("BEGIN TRANSACTION");try{for(let i of t){let a=me({title:i.title,facts:i.facts,narrative:i.narrative});n.run(a,i.id),o++}this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK"),u.warn("DB","subject_key recompute failed \u2014 supersession may not match across the normalizer change",{rows:t.length},i instanceof Error?i:new Error(String(i)));return}o>0&&u.info("DB","Recomputed subject_key for Unicode-aware normalization",{rows:o})}this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(40,new Date().toISOString())}addObservationLastUsedColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(38),t=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="last_used_at");e&&t||(t||this.db.run("ALTER TABLE observations ADD COLUMN last_used_at INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_last_used ON observations(last_used_at)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(38,new Date().toISOString()))}addObservationImportanceColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(36),t=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="importance");e&&t||(t||this.db.run("ALTER TABLE observations ADD COLUMN importance INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(36,new Date().toISOString()))}getIndexColumns(e){return this.db.query(`PRAGMA index_info(${JSON.stringify(e)})`).all().map(s=>s.name)}hasUniqueIndexOnColumns(e,s){return this.db.query(`PRAGMA index_list(${e})`).all().some(n=>{if(n.unique!==1)return!1;let o=this.getIndexColumns(n.name);return o.length===s.length&&o.every((i,a)=>i===s[a])})}resolvePromptSessionDbId(e,s,t){if(s!==void 0)return s;let n=t?C(t):void 0;return n?this.db.prepare(`
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
    `).get(e)?.id??null}dropWorkerPidColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32),t=this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="worker_pid");if(!(e&&!t)){if(t)try{this.db.run("DROP INDEX IF EXISTS idx_pending_messages_worker_pid"),this.db.run("ALTER TABLE pending_messages DROP COLUMN worker_pid"),u.debug("DB","Dropped worker_pid column and its index from pending_messages")}catch(n){u.warn("DB","Failed to drop worker_pid column from pending_messages",{},n instanceof Error?n:new Error(String(n)));return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString())}}ensureSDKSessionsPlatformContentIdentity(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33),s=this.hasUniqueIndexOnColumns("sdk_sessions",["content_session_id"]),t=this.hasUniqueIndexOnColumns("sdk_sessions",["platform_source","content_session_id"]),o=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source");if(!(e&&!s&&t&&o)){if(o||this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${E}'`),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${E}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),s){this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP TABLE IF EXISTS sdk_sessions_new"),this.db.run(`
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
        `),this.db.run("INSERT INTO user_prompts_fts(user_prompts_fts) VALUES('rebuild')")),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString()),this.db.run("COMMIT")}catch(c){throw this.db.run("ROLLBACK"),c}finally{this.db.run("PRAGMA foreign_keys = ON")}}ensurePendingMessagesSessionToolUniqueIndex(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(35);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString());return}let t=this.hasUniqueIndexOnColumns("pending_messages",["session_db_id","tool_use_id"]);if(!(e&&t)){this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP INDEX IF EXISTS ux_pending_session_tool"),this.db.run(`
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
      `),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString()),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}}}dropDeadPendingMessagesColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31),s=this.db.query("PRAGMA table_info(pending_messages)").all(),t=new Set(s.map(i=>i.name)),o=["retry_count","failed_at_epoch","completed_at_epoch"].filter(i=>t.has(i));if(!(e&&o.length===0)){if(o.length>0){this.db.run("BEGIN TRANSACTION");try{this.db.run("DELETE FROM pending_messages WHERE status NOT IN ('pending', 'processing')");for(let i of o)this.db.run(`ALTER TABLE pending_messages DROP COLUMN ${i}`),u.debug("DB",`Dropped dead column ${i} from pending_messages`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString()),this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK"),u.warn("DB","Failed to drop dead columns from pending_messages",{},i instanceof Error?i:new Error(String(i)));return}return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString())}}initializeSchema(){this.db.run(`
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
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(t=>t.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),u.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),u.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),u.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(t=>t.unique===1&&t.origin!=="pk")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}u.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
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
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),u.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let t=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!t||t.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}u.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
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
    `);let t=`
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
    `;try{this.db.run(t),this.db.run(n)}catch(o){o instanceof Error?u.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},o):u.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},new Error(String(o))),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Created user_prompts table (without FTS5)");return}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),u.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),u.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}u.debug("DB","Creating pending_messages table"),this.db.run(`
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
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),u.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;u.debug("DB","Checking session ID columns for semantic clarity rename");let s=0,t=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(l=>l.name===o);return a.some(l=>l.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),u.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(u.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};t("sdk_sessions","claude_session_id","content_session_id")&&s++,t("sdk_sessions","sdk_session_id","memory_session_id")&&s++,t("pending_messages","claude_session_id","content_session_id")&&s++,t("observations","sdk_session_id","memory_session_id")&&s++,t("session_summaries","sdk_session_id","memory_session_id")&&s++,t("user_prompts","claude_session_id","content_session_id")&&s++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),s>0?u.debug("DB",`Successfully renamed ${s} session ID columns`):u.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),u.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21))return;u.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new");let s=this.db.query("PRAGMA table_info(observations)").all(),t=s.some(h=>h.name==="metadata"),n=s.some(h=>h.name==="content_hash"),o=t?`,
        metadata TEXT`:"",i=t?", metadata":"",a=n?`,
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
    `;this.db.run("DROP TRIGGER IF EXISTS session_summaries_ai"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_ad"),this.db.run("DROP TRIGGER IF EXISTS session_summaries_au"),this.db.run("DROP TABLE IF EXISTS session_summaries_new");let g=`
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
    `,f=`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, discovery_tokens, created_at, created_at_epoch
      FROM session_summaries
    `,R=`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `,O=`
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
    `;try{this.recreateObservationsWithCascade(c,l,_,m),this.recreateSessionSummariesWithCascade(g,f,R,O),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),u.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(h){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),h instanceof Error?h:new Error(String(h))}}recreateObservationsWithCascade(e,s,t,n){this.db.run(e),this.db.run(s),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(t),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(n)}recreateSessionSummariesWithCascade(e,s,t,n){this.db.run(e),this.db.run(s),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(t),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(n)}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(t=>t.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),u.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),u.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}addSessionPlatformSourceColumn(){let s=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source"),n=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(i=>i.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&s&&n||(s||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${E}'`),u.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${E}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),n||this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()))}addObservationModelColumns(){let e=this.db.query("PRAGMA table_info(observations)").all(),s=e.some(n=>n.name==="generated_by_model"),t=e.some(n=>n.name==="relevance_count");s&&t||(s||this.db.run("ALTER TABLE observations ADD COLUMN generated_by_model TEXT"),t||this.db.run("ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()))}ensureMergedIntoProjectColumns(){this.db.query("PRAGMA table_info(observations)").all().some(t=>t.name==="merged_into_project")||this.db.run("ALTER TABLE observations ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into ON observations(merged_into_project)"),this.db.query("PRAGMA table_info(session_summaries)").all().some(t=>t.name==="merged_into_project")||this.db.run("ALTER TABLE session_summaries ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into ON session_summaries(merged_into_project)")}addObservationSubagentColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27),s=this.db.query("PRAGMA table_info(observations)").all(),t=s.some(i=>i.name==="agent_type"),n=s.some(i=>i.name==="agent_id");t||this.db.run("ALTER TABLE observations ADD COLUMN agent_type TEXT"),n||this.db.run("ALTER TABLE observations ADD COLUMN agent_id TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_type ON observations(agent_type)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_id ON observations(agent_id)");let o=this.db.query("PRAGMA table_info(pending_messages)").all();if(o.length>0){let i=o.some(d=>d.name==="agent_type"),a=o.some(d=>d.name==="agent_id");i||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_type TEXT"),a||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_id TEXT")}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString())}ensurePendingMessagesToolUseIdColumn(){if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="tool_use_id")||this.db.run("ALTER TABLE pending_messages ADD COLUMN tool_use_id TEXT"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
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
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString()),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}}addObservationsUniqueContentHashIndex(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29))return;let s=this.db.query("PRAGMA table_info(observations)").all(),t=s.some(o=>o.name==="memory_session_id"),n=s.some(o=>o.name==="content_hash");if(!t||!n){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString());return}this.db.run("BEGIN TRANSACTION");try{this.db.run(`
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
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString()),this.db.run("COMMIT")}catch(o){throw this.db.run("ROLLBACK"),o}}addObservationsMetadataColumn(){this.db.query("PRAGMA table_info(observations)").all().some(t=>t.name==="metadata")||(this.db.run("ALTER TABLE observations ADD COLUMN metadata TEXT"),u.debug("DB","Added metadata column to observations table (#2116)")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString())}updateMemorySessionId(e,s){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(s,e)}markSessionCompleted(e){let s=Date.now(),t=new Date(s).toISOString();this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(t,s,e)}ensureMemorySessionIdRegistered(e,s,t){let n=this.db.prepare(`
      SELECT id, memory_session_id, worker_port FROM sdk_sessions WHERE id = ?
    `).get(e);if(!n)throw new Error(`Session ${e} not found in sdk_sessions`);n.memory_session_id!==s&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(s,e),u.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:n.memory_session_id,newId:s})),typeof t=="number"&&n.worker_port!==t&&this.db.prepare(`
        UPDATE sdk_sessions SET worker_port = ? WHERE id = ?
      `).run(t,e)}getRecentSummaries(e,s=10){return this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,s)}getRecentSummariesWithSessionInfo(e,s=3){return this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,s)}getRecentObservations(e,s=20){return this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(e,s)}getAllRecentObservations(e=100){return this.db.prepare(`
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
    `).all(e)}getAllProjects(e){let s=e?C(e):void 0,t=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `,n=[Ue];return s&&(t+=" AND COALESCE(platform_source, ?) = ?",n.push(E,s)),t+=" ORDER BY project ASC",this.db.prepare(t).all(...n).map(i=>i.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${E}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${E}'), project
      ORDER BY latest_epoch DESC
    `).all(Ue),s=[],t=new Set,n={};for(let i of e){let a=C(i.platform_source);n[a]||(n[a]=[]),n[a].includes(i.project)||n[a].push(i.project),t.has(i.project)||(t.add(i.project),s.push(i.project))}let o=Ot(Object.keys(n));return{projects:s,sources:o,projectsBySource:Object.fromEntries(o.map(i=>[i,n[i]||[]]))}}getLatestUserPrompt(e,s){let t=this.resolvePromptSessionDbId(e,s),n=t!==null?"up.session_db_id = ?":"up.content_session_id = ?",o=t!==null?t:e;return this.db.prepare(`
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
    `).get(o)}findRecentDuplicateUserPrompt(e,s,t,n){return At(this.db,e,Ee(s),t,this.resolvePromptSessionDbId(e,n)??void 0)}getRecentSessionsWithStatus(e,s=3,t){let n=[e],o="";return t&&(o=`AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`,n.push(C(t))),n.push(s),this.db.prepare(`
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
    `).all(...n)}getObservationsForSession(e,s){let t=[e],n="";return s&&(n=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions s
          WHERE s.memory_session_id = observations.memory_session_id
            AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?
        )
      `,t.push(C(s))),this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ${n}
      ORDER BY created_at_epoch ASC
    `).all(...t)}getObservationById(e,s){return s?this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      WHERE o.id = ?
        AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?
    `).get(e,C(s))||null:this.db.prepare(`
        SELECT *
        FROM observations
        WHERE id = ?
      `).get(e)||null}getObservationsByIds(e,s={}){if(e.length===0)return[];let{orderBy:t="date_desc",limit:n,project:o,platformSource:i,type:a,concepts:d,files:c}=s,l=t==="relevance",_=l?"":`ORDER BY o.created_at_epoch ${t==="date_asc"?"ASC":"DESC"}`,m=n&&!l?`LIMIT ${n}`:"",g=e.map(()=>"?").join(","),f=[...e],R=[];if(o&&(R.push("o.project = ?"),f.push(o)),i&&(R.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),f.push(C(i))),a)if(Array.isArray(a)){let A=a.map(()=>"?").join(",");R.push(`o.type IN (${A})`),f.push(...a)}else R.push("o.type = ?"),f.push(a);if(d){let A=Array.isArray(d)?d:[d],S=A.map(()=>"EXISTS (SELECT 1 FROM json_each(o.concepts) WHERE value = ?)");f.push(...A),R.push(`(${S.join(" OR ")})`)}if(c){let A=Array.isArray(c)?c:[c],S=A.map(()=>"(EXISTS (SELECT 1 FROM json_each(o.files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(o.files_modified) WHERE value LIKE ?))");A.forEach(y=>{f.push(`%${y}%`,`%${y}%`)}),R.push(`(${S.join(" OR ")})`)}let O=R.length>0?`WHERE o.id IN (${g}) AND ${R.join(" AND ")}`:`WHERE o.id IN (${g})`,v=this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      ${O}
      ${_}
      ${m}
    `).all(...f);if(!l)return v;let w=new Map(v.map(A=>[A.id,A])),T=e.map(A=>w.get(A)).filter(A=>!!A);return n?T.slice(0,n):T}getSummaryForSession(e,s){let t=[e],n="";return s&&(n=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions sdk
          WHERE sdk.memory_session_id = session_summaries.memory_session_id
            AND COALESCE(NULLIF(sdk.platform_source, ''), '${E}') = ?
        )
      `,t.push(C(s))),this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ${n}
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(...t)||null}getFilesForSession(e){let t=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),n=new Set,o=new Set;for(let i of t)je(i.files_read).forEach(a=>n.add(a)),je(i.files_modified).forEach(a=>o.add(a));return{filesRead:Array.from(n),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${E}') as platform_source,
             user_prompt, custom_title, status
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `).get(e)||null}getSdkSessionsBySessionIds(e){if(e.length===0)return[];let s=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${E}') as platform_source,
             user_prompt, custom_title,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${s})
      ORDER BY started_at_epoch DESC
    `).all(...e)}getPromptNumberFromUserPrompts(e,s){let t=this.resolvePromptSessionDbId(e,s);return t!==null?this.db.prepare(`
        SELECT COUNT(*) as count FROM user_prompts WHERE session_db_id = ?
      `).get(t).count:this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,s,t,n,o){let i=new Date,a=i.getTime(),d=Yr(n,o),c=d.platformSource??E,l=this.rt(Ee(t)),_=this.db.prepare(`
      SELECT id, platform_source
      FROM sdk_sessions
      WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
        AND content_session_id = ?
    `).get(E,c,e);if(_)return s&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE id = ? AND (project IS NULL OR project = '')
        `).run(s,_.id),d.customTitle&&this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE id = ? AND custom_title IS NULL
        `).run(d.customTitle,_.id),_.id;let m=this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(e,s,c,l,d.customTitle||null,i.toISOString(),a);return Number(m.lastInsertRowid)}saveUserPrompt(e,s,t,n){let o=new Date,i=o.getTime(),a=this.rt(Ee(t)),d=this.resolvePromptSessionDbId(e,n);return this.db.prepare(`
      INSERT INTO user_prompts
      (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(d,e,s,a,o.toISOString(),i).lastInsertRowid}getUserPrompt(e,s,t){let n=this.resolvePromptSessionDbId(e,t);return n!==null?this.db.prepare(`
        SELECT prompt_text
        FROM user_prompts
        WHERE session_db_id = ? AND prompt_number = ?
        LIMIT 1
      `).get(n,s)?.prompt_text??null:this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,s)?.prompt_text??null}storeObservation(e,s,t,n,o=0,i,a){let d=i??Date.now(),c=new Date(d).toISOString(),l=this.rt(t.title),_=this.rt(t.subtitle),m=this.rt(t.narrative),g=this.rl(t.facts),f=this.rt(t.metadata??null),R=$e(e,l??null,m??null),O=Xe({type:t.type,narrative:m,files_modified:t.files_modified}),h,v=t.source_kind==="curated";if(this.mq.reconcile.enabled&&!v){let S=this.reconcileBeforeInsert(s,t.type,l??null,m??null);if(S.action==="NOOP"&&S.candidateId){let y=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE id = ?").get(S.candidateId);if(y)return{id:y.id,createdAtEpoch:y.created_at_epoch}}else S.action==="UPDATE"&&(h=S.candidateId)}let T=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
       generated_by_model, metadata, importance, valid_from, subject_key,
       source_kind, source_path, source_line, subject, last_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_session_id, content_hash) DO NOTHING
      RETURNING id, created_at_epoch
    `).get(e,s,t.type,l,_,JSON.stringify(g),m,JSON.stringify(t.concepts),JSON.stringify(t.files_read),JSON.stringify(t.files_modified),n||null,o,t.agent_type??null,t.agent_id??null,R,c,d,a||null,f,O,d,me({title:l??null,facts:g,narrative:m??null}),t.source_kind??null,t.source_path??null,t.source_line??null,t.subject??null,t.last_verified_at??null);if(T)return h!==void 0&&this.mq.supersession.enabled&&this.supersedeObservation(h,T.id,d),{id:T.id,createdAtEpoch:T.created_at_epoch};let A=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?").get(e,R);if(!A)throw new Error(`storeObservation: ON CONFLICT without existing row for content_hash=${R}`);return{id:A.id,createdAtEpoch:A.created_at_epoch}}storeSummary(e,s,t,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),l=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,s,this.rt(t.request),this.rt(t.investigated),this.rt(t.learned),this.rt(t.completed),this.rt(t.next_steps),this.rt(t.notes),n||null,o,d,a);return{id:Number(l.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,s,t,n,o,i=0,a,d){let c=a??Date.now(),l=new Date(c).toISOString();return this.db.transaction(()=>{let m=[],g=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model, importance, valid_from, subject_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),f=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let O of t){let h=this.rt(O.title),v=this.rt(O.subtitle),w=this.rt(O.narrative),T=this.rl(O.facts),A=$e(e,h??null,w??null),S=g.get(e,s,O.type,h,v,JSON.stringify(T),w,JSON.stringify(O.concepts),JSON.stringify(O.files_read),JSON.stringify(O.files_modified),o||null,i,O.agent_type??null,O.agent_id??null,A,l,c,d||null,Xe({type:O.type,narrative:w,files_modified:O.files_modified}),c,me({title:h??null,facts:T,narrative:w??null}));if(S){m.push(S.id);continue}let y=f.get(e,A);if(!y)throw new Error(`storeObservations: ON CONFLICT without existing row for content_hash=${A}`);m.push(y.id)}let R=null;if(n){let h=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,s,this.rt(n.request),this.rt(n.investigated),this.rt(n.learned),this.rt(n.completed),this.rt(n.next_steps),this.rt(n.notes),o||null,i,l,c);R=Number(h.lastInsertRowid)}return{observationIds:m,summaryId:R,createdAtEpoch:c}})()}markObservationsUsed(e,s="explicit_fetch",t=Date.now()){if(e.length!==0)try{let n=this.db.query("PRAGMA table_info(observations)").all(),o=g=>n.some(f=>f.name===g),i=o("last_used_at"),a=o("relevance_count"),d=ft[s],c=o(d);if(!i&&!a&&!c)return;let l=[],_=[];i&&(l.push("last_used_at = ?"),_.push(t)),a&&l.push("relevance_count = COALESCE(relevance_count, 0) + 1"),c&&l.push(`${d} = COALESCE(${d}, 0) + 1`);let m=e.map(()=>"?").join(",");this.db.prepare(`UPDATE observations SET ${l.join(", ")} WHERE id IN (${m})`).run(..._,...e)}catch(n){u.debug("DB","markObservationsUsed failed",{count:e.length,channel:s},n instanceof Error?n:new Error(String(n)))}}evaporateScratch(e){try{let s=this.db.prepare("DELETE FROM observations WHERE memory_session_id = ? AND type = 'scratch'").run(e),t=Number(s.changes??0);return t>0&&u.info("DB","Evaporated scratch observations at SessionEnd",{memorySessionId:e,count:t}),t}catch(s){return u.warn("DB","evaporateScratch failed",{memorySessionId:e},s instanceof Error?s:new Error(String(s))),0}}evaporateAllScratch(){try{let e=this.db.prepare("DELETE FROM observations WHERE type = 'scratch'").run(),s=Number(e.changes??0);return s>0&&u.info("DB","Evaporated all scratch observations on idle shutdown",{count:s}),s}catch(e){return u.warn("DB","evaporateAllScratch failed",{},e instanceof Error?e:new Error(String(e))),0}}reconcileBeforeInsert(e,s,t,n){try{let o=Date.now()-7776e6,i=this.db.query("PRAGMA table_info(observations)").all().some(_=>_.name==="valid_to"),a=i?"AND valid_to IS NULL":"",d=this.db.prepare(`
        SELECT id, title, narrative, importance
        FROM observations
        WHERE project = ? AND type = ? AND created_at_epoch >= ? ${a}
        ORDER BY created_at_epoch DESC
        LIMIT 20
      `).all(e,s,o);if(d.length===0)return{action:"ADD"};let c=this.mq.supersession.enabled&&i;return Rt({title:t,narrative:n},d,{noopThreshold:this.mq.reconcile.noopThreshold,updateBand:this.mq.reconcile.updateBand,supersessionEnabled:c})}catch(o){return u.warn("DB","reconcileBeforeInsert failed; defaulting to ADD",{project:e,type:s},o instanceof Error?o:new Error(String(o))),{action:"ADD"}}}supersedeObservation(e,s,t){try{this.db.prepare(`
        UPDATE observations
           SET valid_to = ?,
               metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?)
         WHERE id = ? AND valid_to IS NULL
      `).run(t,s,e)}catch(n){u.warn("DB","supersedeObservation failed",{oldId:e,newId:s},n instanceof Error?n:new Error(String(n)))}}getObservationsAsOf(e,s){return this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="valid_from")?this.db.prepare(`
      SELECT * FROM observations
      WHERE project = ?
        AND COALESCE(valid_from, created_at_epoch) <= ?
        AND (valid_to IS NULL OR valid_to > ?)
    `).all(e,s,s):this.db.prepare("SELECT * FROM observations WHERE project = ?").all(e)}storeCheckpoint(e,s,t={}){let n=this.getOrCreateManualSession(e),o=Date.now(),i=t.title&&t.title.trim()?t.title.trim():Mt(s),a={checkpoint:!0};t.focus&&t.focus.trim()&&(a.focus=t.focus.trim());let d=this.storeObservation(n,e,{type:X,title:i,subtitle:"Session checkpoint",facts:[],narrative:s,concepts:[],files_read:[],files_modified:[],metadata:JSON.stringify(a),source_kind:"curated"},0,0,o,t.generatedByModel??void 0);return this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.superseded_by_checkpoint')
       WHERE id = ? AND type = ?
    `).run(d.id,X),this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by_checkpoint', ?)
       WHERE project = ? AND type = ? AND valid_to IS NULL AND id != ?
    `).run(o,d.id,e,X,d.id),u.info("DB","Saved session checkpoint",{id:d.id,project:e,title:i}),d}clearCheckpoint(e){let s=Date.now(),t=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.checkpoint_cleared', 1)
       WHERE project = ? AND type = ? AND valid_to IS NULL
    `).run(s,e,X),n=Number(t.changes??0);return u.info("DB","Cleared session checkpoint(s)",{project:e,cleared:n}),{cleared:n}}static REVISION_MARKER="revised_by";getCuratedRecord(e,s,t={}){let n=t.includeClosed?"":"AND valid_to IS NULL",o=this.db.prepare(`
      SELECT id, project, ${k} AS record_id,
             title, subtitle, narrative, metadata, source_path, source_line,
             valid_from, valid_to, created_at_epoch
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${k} = ?
         ${n}
       ORDER BY (valid_to IS NULL) DESC, created_at_epoch DESC, id DESC
       LIMIT 1
    `).get(e,s);return o?{...o,kind:xt(o.metadata,o.record_id)}:null}getCuratedRevisions(e,s){return this.db.prepare(`
      SELECT id, title, narrative, metadata, valid_from, valid_to, created_at_epoch
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${k} = ?
       ORDER BY created_at_epoch DESC, id DESC
    `).all(e,s)}curatedProjects(){return this.db.prepare(`
      SELECT DISTINCT project FROM observations
       WHERE source_kind = 'curated' AND project IS NOT NULL AND project != ''
       ORDER BY project ASC
    `).all().map(s=>String(s.project))}closeOtherCuratedRevisions(e,s,t,n=Date.now()){let o=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${r.REVISION_MARKER}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND ${k} = ?
         AND valid_to IS NULL AND id != ?
    `).run(n,t,e,s,t);return{closed:Number(o?.changes??0)}}closeOtherCuratedRowsForSource(e,s,t,n=Date.now()){let o=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${r.REVISION_MARKER}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND source_path = ?
         AND valid_to IS NULL AND id != ?
    `).run(n,t,e,s,t);return{closed:Number(o?.changes??0)}}refreshCuratedDerived(e,s){let t=[],n=[];s.subtitle!==void 0&&(t.push("subtitle = ?"),n.push(this.rt(s.subtitle)??null)),s.metadata!==void 0&&(t.push("metadata = ?"),n.push(this.rt(s.metadata)??null)),s.lastVerifiedAt!==void 0&&(t.push("last_verified_at = ?"),n.push(s.lastVerifiedAt??null)),t.length!==0&&(n.push(e),this.db.prepare(`UPDATE observations SET ${t.join(", ")} WHERE id = ?`).run(...n))}curatedObservationIds(e){return this.db.prepare(`
      SELECT id FROM observations
       WHERE project = ? AND source_kind = 'curated'
       ORDER BY id ASC
    `).all(e).map(t=>Number(t.id))}nextCuratedRecordId(e){let s=this.db.prepare(`
      SELECT DISTINCT ${k} AS record_id
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${k} IS NOT NULL
    `).all(e),t=0;for(let o of s){let i=String(o.record_id??"");if(!/^0\d{3}$/.test(i))continue;let a=parseInt(i,10);Number.isFinite(a)&&a>t&&(t=a)}let n=t+1;if(n>999)throw new Error(`curated authoring: project "${e}" has reached record 0999. The edge reader only recognises zero-padded four-digit decision numbers, so the numbering cannot continue without widening relation-lexicon/edge-reader.`);return String(n).padStart(4,"0")}storeCuratedRecord(e,s,t,n=Date.now()){let o=this.storeObservation(e,s,{type:"decision",title:t.title,subtitle:t.subtitle,facts:[],narrative:t.narrative,concepts:[],files_read:[],files_modified:[],metadata:t.metadata,source_kind:"curated",source_path:t.sourcePath,source_line:t.sourceLine,subject:t.subject,last_verified_at:t.lastVerifiedAt},0,0,n);this.db.prepare(`
      UPDATE observations
         SET valid_from = ?,
             valid_to = ?,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.${r.REVISION_MARKER}')
       WHERE id = ?
    `).run(t.validFrom,t.validTo,o.id);let i=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${r.REVISION_MARKER}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND ${k} = ?
         AND valid_to IS NULL AND id != ?
    `).run(n,o.id,s,t.recordId,o.id);return{...o,revisionsClosed:Number(i?.changes??0)}}closeCuratedRecord(e,s,t={}){let n=t.nowEpoch??Date.now(),o=this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(
               COALESCE(metadata, '{}'),
               '$.closed_by_author', 1,
               '$.closed_reason', ?
             )
       WHERE project = ? AND source_kind = 'curated'
         AND ${k} = ?
         AND valid_to IS NULL
    `).run(n,t.reason??null,e,s),i=Number(o?.changes??0);return u.info("DB","Closed curated record",{project:e,recordId:s,closed:i}),{closed:i}}reopenCuratedRecord(e,s){let t=this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.closed_by_author', '$.closed_reason')
       WHERE project = ? AND source_kind = 'curated'
         AND ${k} = ?
         AND json_extract(metadata, '$.closed_by_author') IS NOT NULL
    `).run(e,s);return{reopened:Number(t?.changes??0)}}getActiveCheckpoints(e){if(e.length===0)return[];let s=e.map(()=>"?").join(",");return this.db.prepare(`
      SELECT id, project, title, narrative, metadata, created_at, created_at_epoch
        FROM observations
       WHERE project IN (${s})
         AND type = ?
         AND valid_to IS NULL
       ORDER BY created_at_epoch DESC
    `).all(...e,X)}deleteObservationsByProject(e,s={}){let t=(e??"").trim();if(t===""||t==="*")throw new Error(`deleteObservationsByProject: refusing unsafe project '${e}'`);let n=this.db.prepare("SELECT count(*) AS c FROM observations WHERE project = ?").get(t).c,o=this.db.prepare("SELECT count(*) AS c FROM session_summaries WHERE project = ?").get(t).c,a=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_edges'").all().length>0?this.db.prepare("SELECT count(*) AS c FROM decision_edges WHERE project = ?").get(t).c:0;if(s.dryRun)return{project:t,dryRun:!0,observationsDeleted:n,summariesDeleted:o,edgesDeleted:a};this.db.transaction(()=>{this.db.prepare("DELETE FROM observations WHERE project = ?").run(t),this.db.prepare("DELETE FROM session_summaries WHERE project = ?").run(t),a>0&&this.db.prepare("DELETE FROM decision_edges WHERE project = ?").run(t)})();try{this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}catch(c){u.warn("DB","observations_fts rebuild after project delete failed",{project:t},c instanceof Error?c:new Error(String(c)))}return u.info("DB","Deleted observations by project",{project:t,observationsDeleted:n,summariesDeleted:o,edgesDeleted:a}),{project:t,dryRun:!1,observationsDeleted:n,summariesDeleted:o,edgesDeleted:a}}getSessionSummariesByIds(e,s={}){if(e.length===0)return[];let{orderBy:t="date_desc",limit:n,project:o,platformSource:i}=s,a=t==="relevance",d=a?"":`ORDER BY ss.created_at_epoch ${t==="date_asc"?"ASC":"DESC"}`,c=n&&!a?`LIMIT ${n}`:"",l=e.map(()=>"?").join(","),_=[...e],m=[];o&&(m.push("ss.project = ?"),_.push(o)),i&&(m.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),_.push(C(i)));let g=m.length>0?`AND ${m.join(" AND ")}`:"",R=this.db.prepare(`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON s.memory_session_id = ss.memory_session_id
      WHERE ss.id IN (${l}) ${g}
      ${d}
      ${c}
    `).all(..._);if(!a)return R;let O=new Map(R.map(v=>[v.id,v])),h=e.map(v=>O.get(v)).filter(v=>!!v);return n?h.slice(0,n):h}getUserPromptsByIds(e,s={}){if(e.length===0)return[];let{orderBy:t="date_desc",limit:n,project:o,platformSource:i}=s,a=t==="relevance",d=a?"":`ORDER BY up.created_at_epoch ${t==="date_asc"?"ASC":"DESC"}`,c=n?`LIMIT ${n}`:"",l=e.map(()=>"?").join(","),_=[...e],m=[];o&&(m.push("s.project = ?"),_.push(o)),i&&(m.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),_.push(C(i)));let g=m.length>0?`AND ${m.join(" AND ")}`:"",R=this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.id IN (${l}) ${g}
      ${d}
      ${c}
    `).all(..._);if(!a)return R;let O=new Map(R.map(h=>[h.id,h]));return e.map(h=>O.get(h)).filter(h=>!!h)}getTimelineAroundTimestamp(e,s=10,t=10,n,o){return this.getTimelineAroundObservation(null,e,s,t,n,o)}getTimelineAroundObservation(e,s,t=10,n=10,o,i){let a=i?C(i):void 0,d=(T,A)=>{let S=[],y=[];return o&&(S.push(`${T}.project = ?`),y.push(o)),a&&(S.push(`COALESCE(NULLIF(${A}.platform_source, ''), '${E}') = ?`),y.push(a)),{clause:S.length>0?`AND ${S.join(" AND ")}`:"",params:y}},c=d("o","src"),l=d("ss","src"),_=d("s","s"),m,g;if(e!==null){let T=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id <= ? ${c.clause}
        ORDER BY o.id DESC
        LIMIT ?
      `,A=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id >= ? ${c.clause}
        ORDER BY o.id ASC
        LIMIT ?
      `;try{let S=this.db.prepare(T).all(e,...c.params,t+1),y=this.db.prepare(A).all(e,...c.params,n+1);if(S.length===0&&y.length===0)return{observations:[],sessions:[],prompts:[]};m=S.length>0?S[S.length-1].created_at_epoch:s,g=y.length>0?y[y.length-1].created_at_epoch:s}catch(S){return S instanceof Error?u.error("DB","Error getting boundary observations",{project:o},S):u.error("DB","Error getting boundary observations with non-Error",{},new Error(String(S))),{observations:[],sessions:[],prompts:[]}}}else{let T=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch <= ? ${c.clause}
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `,A=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch >= ? ${c.clause}
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `;try{let S=this.db.prepare(T).all(s,...c.params,t),y=this.db.prepare(A).all(s,...c.params,n+1);if(S.length===0&&y.length===0)return{observations:[],sessions:[],prompts:[]};m=S.length>0?S[S.length-1].created_at_epoch:s,g=y.length>0?y[y.length-1].created_at_epoch:s}catch(S){return S instanceof Error?u.error("DB","Error getting boundary timestamps",{project:o},S):u.error("DB","Error getting boundary timestamps with non-Error",{},new Error(String(S))),{observations:[],sessions:[],prompts:[]}}}let f=`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
      WHERE o.created_at_epoch >= ? AND o.created_at_epoch <= ? ${c.clause}
      ORDER BY o.created_at_epoch ASC
    `,R=`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions src ON src.memory_session_id = ss.memory_session_id
      WHERE ss.created_at_epoch >= ? AND ss.created_at_epoch <= ? ${l.clause}
      ORDER BY ss.created_at_epoch ASC
    `,O=`
      SELECT up.*, s.project, s.memory_session_id, COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${_.clause}
      ORDER BY up.created_at_epoch ASC
    `,h=this.db.prepare(f).all(m,g,...c.params),v=this.db.prepare(R).all(m,g,...l.params),w=this.db.prepare(O).all(m,g,..._.params);return{observations:h,sessions:v.map(T=>({id:T.id,memory_session_id:T.memory_session_id,project:T.project,request:T.request,completed:T.completed,next_steps:T.next_steps,created_at:T.created_at,created_at_epoch:T.created_at_epoch})),prompts:w.map(T=>({id:T.id,content_session_id:T.content_session_id,prompt_number:T.prompt_number,prompt_text:T.prompt_text,project:T.project,platform_source:T.platform_source,created_at:T.created_at,created_at_epoch:T.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
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
    `).get(e)||null}getPromptsByIds(e){if(e.length===0)return[];let s=e.map(()=>"?").join(",");return this.db.prepare(`
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
	      WHERE p.id IN (${s})
      ORDER BY p.created_at_epoch DESC
    `).all(...e)}getOrCreateManualSession(e){let s=`manual-${e}`,t=`manual-content-${e}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(s))return s;let o=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(s,t,e,E,o.toISOString(),o.getTime()),u.info("SESSION","Created manual session",{memorySessionId:s,project:e}),s}close(){this.db.close()}importSdkSession(e){let s=C(e.platform_source),t=this.db.prepare(`SELECT id FROM sdk_sessions
       WHERE platform_source = ? AND content_session_id = ?`).get(s,e.content_session_id);return t?{imported:!1,id:t.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, platform_source, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.content_session_id,e.memory_session_id,e.project,s,e.user_prompt,e.started_at,e.started_at_epoch,e.completed_at,e.completed_at_epoch,e.status).lastInsertRowid}}importSessionSummary(e){let s=this.db.prepare("SELECT id FROM session_summaries WHERE memory_session_id = ?").get(e.memory_session_id);return s?{imported:!1,id:s.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.request,e.investigated,e.learned,e.completed,e.next_steps,e.files_read,e.files_edited,e.notes,e.prompt_number,e.discovery_tokens||0,e.created_at,e.created_at_epoch).lastInsertRowid}}importObservation(e){let s=this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(e.memory_session_id,e.title,e.created_at_epoch);return s?{imported:!1,id:s.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, agent_type, agent_id,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.agent_type??null,e.agent_id??null,e.created_at,e.created_at_epoch).lastInsertRowid}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let s=null,t=e.platform_source?C(e.platform_source):void 0;if(typeof e.session_db_id=="number"){let a=this.db.prepare(`
        SELECT id, content_session_id, COALESCE(NULLIF(platform_source, ''), '${E}') as platform_source
        FROM sdk_sessions
        WHERE id = ?
        LIMIT 1
      `).get(e.session_db_id);a&&a.content_session_id===e.content_session_id&&(!t||C(a.platform_source)===t)&&(s=a.id)}s===null&&(s=this.resolvePromptSessionDbId(e.content_session_id,void 0,t));let n=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE ${s!==null?"session_db_id = ?":"content_session_id = ?"} AND prompt_number = ?
    `).get(s??e.content_session_id,e.prompt_number);return n?{imported:!1,id:n.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        session_db_id, content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(s,e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}};var kt=require("os"),Ut=V(require("path"),1),Ft=require("child_process");var Te=require("fs"),fe=V(require("path"),1);var Q={isWorktree:!1,worktreeName:null,parentRepoPath:null,parentProjectName:null};function Pt(r){let e=fe.default.join(r,".git"),s;try{s=(0,Te.statSync)(e)}catch(l){return l instanceof Error&&l.code!=="ENOENT"&&u.warn("GIT","Unexpected error checking .git",{error:l instanceof Error?l.message:String(l)}),Q}if(!s.isFile())return Q;let t;try{t=(0,Te.readFileSync)(e,"utf-8").trim()}catch(l){return u.warn("GIT","Failed to read .git file",{error:l instanceof Error?l.message:String(l)}),Q}let n=t.match(/^gitdir:\s*(.+)$/);if(!n)return Q;let i=n[1].match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)$/);if(!i)return Q;let a=i[1],d=fe.default.basename(r),c=fe.default.basename(a);return{isWorktree:!0,worktreeName:d,parentRepoPath:a,parentProjectName:c}}function $t(r){return r==="~"||r.startsWith("~/")?r.replace(/^~/,(0,kt.homedir)()):r}var z=new Map,W=new Map,qr=6e4,wt=256;function Jr(r,e=Date.now()){let s=z.get(r);if(s!==void 0)return s;let t=W.get(r);if(t!==void 0&&e-t<qr)return null;let n=Qr(r);if(n){if(z.size>=wt){let o=z.keys().next();o.done||z.delete(o.value)}z.set(r,n),W.delete(r)}else{if(W.size>=wt){let o=W.keys().next();o.done||W.delete(o.value)}W.set(r,e)}return n}function Qr(r){try{return(0,Ft.execFileSync)("git",["rev-parse","--show-toplevel"],{cwd:r,encoding:"utf-8",stdio:["ignore","pipe","ignore"],windowsHide:!0}).trim()||null}catch{return null}}function zr(r){if(!r||r.trim()==="")return u.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=$t(r),t=Jr(e)??e,n=Ut.default.basename(t);if(n===""){if(process.platform==="win32"){let i=r.match(/^([A-Z]):\\/i);if(i){let d=`drive-${i[1].toUpperCase()}`;return u.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:d}),d}}return u.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}return n}function jt(r){let e=zr(r);if(!r)return{primary:e,parent:null,isWorktree:!1,allProjects:[e]};let s=$t(r),t=Pt(s);if(t.isWorktree&&t.parentProjectName){let n=`${t.parentProjectName}/${e}`;return{primary:n,parent:t.parentProjectName,isWorktree:!0,allProjects:[t.parentProjectName,n]}}return{primary:e,parent:null,isWorktree:!1,allProjects:[e]}}var F=require("fs"),ee=require("path"),Ye=require("os");var Ve={DEFAULT:3e5,HEALTH_CHECK:3e3,API_REQUEST:3e4,HOOK_READINESS_WAIT:1e4,POST_SPAWN_WAIT:15e3,READINESS_WAIT:3e4,PORT_IN_USE_WAIT:3e3,WORKER_STARTUP_WAIT:1e3,PRE_RESTART_SETTLE_DELAY:2e3,POWERSHELL_COMMAND:1e4,WINDOWS_MULTIPLIER:1.5};function Ht(r){return process.platform==="win32"?Math.round(r*Ve.WINDOWS_MULTIPLIER):r}var I=require("fs");var U=require("path");var Kt=require("crypto");var Zr=process.platform==="win32";function en(r){(0,I.existsSync)(r)||(0,I.mkdirSync)(r,{recursive:!0})}function Z(r,e){let s=r;try{if((0,I.lstatSync)(r).isSymbolicLink())try{s=(0,I.realpathSync)(r)}catch{let c=(0,I.readlinkSync)(r);s=(0,U.resolve)((0,U.dirname)(r),c)}}catch(c){let l=c.code;if(l!=="ENOENT"&&l!=="ENOTDIR")throw c}en((0,U.dirname)(s));let t=(0,U.dirname)(s),n=(0,U.basename)(s),o=(0,U.join)(t,`.${n}.${process.pid}.${(0,Kt.randomBytes)(6).toString("hex")}.tmp`),i=Buffer.from(JSON.stringify(e,null,2)+`
`,"utf-8"),a;try{a=(0,I.statSync)(s).mode&511}catch{}let d;try{d=a!==void 0?(0,I.openSync)(o,"w",a):(0,I.openSync)(o,"w");let c=0;for(;c<i.length;){let l=(0,I.writeSync)(d,i,c,i.length-c);if(l===0)throw new Error(`writeSync stalled at ${c}/${i.length} bytes`);c+=l}if((0,I.fsyncSync)(d),(0,I.closeSync)(d),d=void 0,(0,I.renameSync)(o,s),!Zr){let l;try{l=(0,I.openSync)(t,"r"),(0,I.fsyncSync)(l)}catch{}finally{if(l!==void 0)try{(0,I.closeSync)(l)}catch{}}}}catch(c){if(d!==void 0)try{(0,I.closeSync)(d)}catch{}try{(0,I.unlinkSync)(o)}catch{}throw c}}var be=class{static DEFAULTS={KEEPMIND_MODEL:"claude-haiku-4-5-20251001",KEEPMIND_CONTEXT_OBSERVATIONS:"50",KEEPMIND_WORKER_PORT:String(37700+(process.getuid?.()??77)%100),KEEPMIND_WORKER_HOST:"127.0.0.1",KEEPMIND_API_TIMEOUT_MS:String(Ht(Ve.API_REQUEST)),KEEPMIND_SKIP_TOOLS:["ListMcpResourcesTool","SlashCommand","Skill","TodoWrite","AskUserQuestion","ToolSearch","BashOutput","KillShell","EnterPlanMode","ExitPlanMode","TaskCreate","TaskUpdate","TaskList","TaskGet","TaskOutput","TaskStop","Glob","Grep"].join(","),KEEPMIND_PROVIDER:"claude",KEEPMIND_CLAUDE_AUTH_METHOD:"subscription",KEEPMIND_GEMINI_API_KEY:"",KEEPMIND_GEMINI_MODEL:"gemini-2.5-flash-lite",KEEPMIND_GEMINI_RATE_LIMITING_ENABLED:"true",KEEPMIND_GEMINI_MAX_CONTEXT_MESSAGES:"20",KEEPMIND_GEMINI_MAX_TOKENS:"100000",KEEPMIND_OPENROUTER_API_KEY:"",KEEPMIND_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",KEEPMIND_OPENROUTER_BASE_URL:"",KEEPMIND_OPENROUTER_SITE_URL:"",KEEPMIND_OPENROUTER_APP_NAME:"keepmind",KEEPMIND_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",KEEPMIND_OPENROUTER_MAX_TOKENS:"100000",KEEPMIND_DATA_DIR:(0,ee.join)((0,Ye.homedir)(),".keepmind"),KEEPMIND_LOG_LEVEL:"INFO",CLAUDE_CODE_PATH:"",KEEPMIND_MODE:"code",KEEPMIND_CONTEXT_SHOW_READ_TOKENS:"false",KEEPMIND_CONTEXT_SHOW_WORK_TOKENS:"false",KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT:"true",KEEPMIND_CONTEXT_FULL_COUNT:"0",KEEPMIND_CONTEXT_FULL_FIELD:"narrative",KEEPMIND_CONTEXT_SESSION_COUNT:"5",KEEPMIND_OBSERVATION_BATCH_MAX:"8",KEEPMIND_OBSERVATION_COALESCE_MS:"2500",KEEPMIND_MAX_CONTEXT_MESSAGES:"40",KEEPMIND_OBSERVER_SESSION_MODE:"stateless",KEEPMIND_OBS_FIELD_MAX_CHARS:"2000",KEEPMIND_CAPTURE_PROFILE:"",KEEPMIND_OBSERVE_TRIGGER:"batched",KEEPMIND_ENABLED:"true",KEEPMIND_FILE_CONTEXT_ENABLED:"true",KEEPMIND_DECISION_CHECK_ENABLED:"true",KEEPMIND_DECISION_CHECK_MAX_ROWS:"3",KEEPMIND_CURATED_PROJECT:"",KEEPMIND_FILE_CONTEXT_MIN_BYTES:"1500",KEEPMIND_FILE_CONTEXT_MAX_ROWS:"3",KEEPMIND_FILE_CONTEXT_MIN_SCORE:"2",KEEPMIND_SESSION_START_INJECT:"true",KEEPMIND_SESSION_START_MAX_CHARS:"4500",KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY:"true",KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE:"false",KEEPMIND_INJECT_SOURCE_KIND:"all",KEEPMIND_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",KEEPMIND_WELCOME_HINT_ENABLED:"true",KEEPMIND_UPDATE_CHECK_ENABLED:"true",KEEPMIND_MCP_SMART_TOOLS:"false",KEEPMIND_MCP_CORPUS_TOOLS:"false",KEEPMIND_FOLDER_CLAUDEMD_ENABLED:"false",KEEPMIND_FOLDER_USE_LOCAL_MD:"false",KEEPMIND_TRANSCRIPTS_ENABLED:"true",KEEPMIND_TRANSCRIPTS_CONFIG_PATH:(0,ee.join)((0,Ye.homedir)(),".keepmind","transcript-watch.json"),KEEPMIND_CODEX_TRANSCRIPT_INGESTION:"false",KEEPMIND_MAX_CONCURRENT_AGENTS:"2",KEEPMIND_HOOK_FAIL_LOUD_THRESHOLD:"3",KEEPMIND_EXCLUDED_PROJECTS:"",KEEPMIND_FOLDER_MD_EXCLUDE:"[]",KEEPMIND_FOLDER_MD_SKELETON_DENYLIST:"[]",KEEPMIND_SEMANTIC_INJECT:"false",KEEPMIND_SEMANTIC_INJECT_LIMIT:"5",KEEPMIND_TIER_ROUTING_ENABLED:"false",KEEPMIND_TIER_SIMPLE_MODEL:"haiku",KEEPMIND_TIER_SUMMARY_MODEL:"",KEEPMIND_TIER_FAST_MODEL:"haiku",KEEPMIND_TIER_SMART_MODEL:"sonnet",KEEPMIND_CHROMA_ENABLED:"true",KEEPMIND_TELEGRAM_ENABLED:"true",KEEPMIND_TELEGRAM_BOT_TOKEN:"",KEEPMIND_TELEGRAM_CHAT_ID:"",KEEPMIND_TELEGRAM_TRIGGER_TYPES:"security_alert",KEEPMIND_TELEGRAM_TRIGGER_CONCEPTS:"",KEEPMIND_QUEUE_ENGINE:"sqlite",KEEPMIND_REDIS_URL:"",KEEPMIND_REDIS_HOST:"127.0.0.1",KEEPMIND_REDIS_PORT:"6379",KEEPMIND_REDIS_MODE:"external",KEEPMIND_QUEUE_REDIS_PREFIX:`keepmind_${D("KEEPMIND_WORKER_PORT")??String(37700+(process.getuid?.()??77)%100)}`,KEEPMIND_AUTH_MODE:"api-key",KEEPMIND_RUNTIME:"worker",KEEPMIND_SERVER_URL:`http://127.0.0.1:${D("KEEPMIND_SERVER_PORT")??String(37877+(process.getuid?.()??77)%100)}`,KEEPMIND_SERVER_API_KEY:"",KEEPMIND_SERVER_PROJECT_ID:"",KEEPMIND_SERVER_BETA_URL:`http://127.0.0.1:${D("KEEPMIND_SERVER_PORT")??String(37877+(process.getuid?.()??77)%100)}`,KEEPMIND_SERVER_BETA_API_KEY:"",KEEPMIND_SERVER_BETA_PROJECT_ID:""};static getAllDefaults(){return{...this.DEFAULTS}}static envOverride(e){return D(e)}static get(e){return this.envOverride(e)??this.DEFAULTS[e]}static getInt(e){let s=this.get(e);return parseInt(s,10)}static getBool(e){let s=this.get(e);return s==="true"||s===!0}static applyEnvOverrides(e){let s={...e};for(let t of Object.keys(this.DEFAULTS)){let n=this.envOverride(t);n!==void 0&&(s[t]=n)}return s}static toCanonicalKeys(e){let s={};for(let[t,n]of Object.entries(e)){if(!t.startsWith("CLAUDE_MEM_")){s[t]=n;continue}let o="KEEPMIND_"+t.slice(11);e[o]===void 0&&(s[o]=n)}return s}static loadFromFile(e,s=!0){try{if(!(0,F.existsSync)(e)){let a=this.getAllDefaults();try{let d=(0,ee.dirname)(e);(0,F.existsSync)(d)||(0,F.mkdirSync)(d,{recursive:!0}),Z(e,a),console.warn("[SETTINGS] Created settings file with defaults:",e)}catch(d){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,d instanceof Error?d.message:String(d))}return s?this.applyEnvOverrides(a):a}let t=(0,F.readFileSync)(e,"utf-8"),n=JSON.parse(t.replace(/^\uFEFF/,"")),o=n;if(n.env&&typeof n.env=="object"){o=n.env;try{Z(e,o),console.warn("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(a){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,a instanceof Error?a.message:String(a))}}let i={...this.DEFAULTS};for(let a of Object.keys(this.DEFAULTS)){let d=G(a,o);d!==void 0&&(i[a]=d)}if(pt(o))try{Z(e,this.toCanonicalKeys(o)),console.warn("[SETTINGS] Migrated settings file to the KEEPMIND_* key prefix:",e)}catch(a){console.warn("[SETTINGS] Failed to migrate settings keys (legacy names still honored):",e,a instanceof Error?a.message:String(a))}return s?this.applyEnvOverrides(i):i}catch(t){console.warn("[SETTINGS] Failed to load settings, using defaults:",e,t instanceof Error?t.message:String(t));let n=this.getAllDefaults();try{if((0,F.existsSync)(e)){let o=`${e}.corrupt-${Date.now()}`;(0,F.renameSync)(e,o),console.warn("[SETTINGS] Backed up corrupt settings file to:",o)}Z(e,n),console.warn("[SETTINGS] Recovered settings file with defaults:",e)}catch(o){console.warn("[SETTINGS] Failed to recover corrupt settings file:",e,o instanceof Error?o.message:String(o))}return s?this.applyEnvOverrides(n):n}}};var te=require("fs"),he=require("path");var M=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=gt(),s=D("KEEPMIND_MODES_DIR"),t=[...s?[s]:[],(0,he.join)(e,"modes"),(0,he.join)(e,"..","plugin","modes")],n=t.find(o=>(0,te.existsSync)(o));this.modesDir=n||t[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let s=e.split("--");if(s.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(s.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:s[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,s){let t={...e};for(let n in s){let o=s[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?t[n]=this.deepMerge(i,o):t[n]=o}return t}loadModeFile(e){let s=(0,he.join)(this.modesDir,`${e}.json`);if(!(0,te.existsSync)(s))throw new Error(`Mode file not found: ${s}`);let t=(0,te.readFileSync)(s,"utf-8");return JSON.parse(t)}loadMode(e){let s=this.parseInheritance(e);if(!s.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,u.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(c=>c.id),concepts:d.observation_concepts.map(c=>c.id)}),d}catch(d){if(d instanceof Error?u.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{message:d.message}):u.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{error:String(d)}),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:t,overrideId:n}=s,o;try{o=this.loadMode(t)}catch(d){d instanceof Error?u.warn("WORKER",`Parent mode '${t}' not found for ${e}, falling back to 'code'`,{message:d.message}):u.warn("WORKER",`Parent mode '${t}' not found for ${e}, falling back to 'code'`,{error:String(d)}),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),u.debug("SYSTEM",`Loaded override file: ${n} for parent ${t}`)}catch(d){return d instanceof Error?u.warn("WORKER",`Override file '${n}' not found, using parent mode '${t}' only`,{message:d.message}):u.warn("WORKER",`Override file '${n}' not found, using parent mode '${t}' only`,{error:String(d)}),this.activeMode=o,o}if(!i)return u.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${t}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,u.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${t} + ${n})`,void 0,{parent:t,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getTypeIcon(e){return this.getObservationTypes().find(t=>t.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(t=>t.id===e)?.work_emoji||"\u{1F4DD}"}};function Gt(){let r=K.settings(),e=be.loadFromFile(r),s=M.getInstance().getActiveMode(),t=new Set(s.observation_types.map(o=>o.id)),n=new Set(s.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.KEEPMIND_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.KEEPMIND_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.KEEPMIND_CONTEXT_SESSION_COUNT,10),showReadTokens:e.KEEPMIND_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.KEEPMIND_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:t,observationConcepts:n,fullObservationField:e.KEEPMIND_CONTEXT_FULL_FIELD,showLastSummary:e.KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE==="true",injectSourceKind:tn(e.KEEPMIND_INJECT_SOURCE_KIND)}}function tn(r){let e=(r??"").trim().toLowerCase();return e==="curated"||e==="observed"?e:"all"}var p={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},Se=4,qe=1;function Je(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/Se)}function Qe(r){let e=r.length,s=r.reduce((i,a)=>i+Je(a),0),t=r.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=t-s,o=t>0?Math.round(n/t*100):0;return{totalObservations:e,totalReadTokens:s,totalDiscoveryTokens:t,savings:n,savingsPercent:o}}function sn(r){return M.getInstance().getWorkEmoji(r)}function se(r,e){let s=Je(r),t=r.discovery_tokens||0,n=sn(r.type),o=t>0?`${n} ${t.toLocaleString("en-US")}`:"-";return{readTokens:s,discoveryTokens:t,discoveryDisplay:o,workEmoji:n}}function Ne(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}function rn(r){return on(r)}var nn=28;function on(r){let e=(r.title?.length??8)+nn;return Math.max(1,Math.ceil(e/Se))}function an(r,e){if(!Number.isFinite(e)||e<=0)return r;let s=[],t=0;for(let n of r){let o=rn(n);t+o>e||(s.push(n),t+=o)}return s}function Bt(r,e){let s=e.now??Date.now(),t=r.map(i=>({o:i,score:ht(i,{now:s,halfLifeDays:e.halfLifeDays})})).sort((i,a)=>a.score-i.score).map(i=>i.o),n=e.maxRows>0?t.slice(0,e.maxRows):t;return an(n,e.tokenBudget).sort((i,a)=>(a.created_at_epoch??0)-(i.created_at_epoch??0))}var Xt=V(require("path"),1),Re=require("fs");function Wt(r,e,s,t){let n=Array.from(s.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(s.observationConcepts),a=i.map(()=>"?").join(",");return r.db.prepare(`
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
      -- Origin filter (A9). Rows written before the curated path existed have
      -- source_kind NULL, so they must read as 'observed' rather than falling
      -- out of every filtered query.
      AND (? = 'all' OR COALESCE(o.source_kind, 'observed') = ?)
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
  `).all(e,e,t??null,t??null,s.injectSourceKind??"all",s.injectSourceKind??"all",...n,...i,s.totalObservationCount)}function Vt(r,e,s,t){return r.db.prepare(`
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
  `).all(e,e,t??null,t??null,s.sessionCount+qe)}function Yt(r,e,s,t){let n=Array.from(s.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(s.observationConcepts),a=i.map(()=>"?").join(","),d=e.map(()=>"?").join(",");return r.db.prepare(`
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
      AND (? = 'all' OR COALESCE(o.source_kind, 'observed') = ?)
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
  `).all(...e,...e,t??null,t??null,s.injectSourceKind??"all",s.injectSourceKind??"all",...n,...i,s.totalObservationCount)}function qt(r,e,s,t){let n=e.map(()=>"?").join(",");return r.db.prepare(`
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
  `).all(...e,...e,t??null,t??null,s.sessionCount+qe)}function dn(r){return r.replace(/[/.]/g,"-")}function cn(r){if(!r.includes('"type":"assistant"'))return null;let e=JSON.parse(r);if(e.type==="assistant"&&e.message?.content&&Array.isArray(e.message.content)){let s="";for(let t of e.message.content)t.type==="text"&&(s+=t.text);if(s=s.replace(vt,"").trim(),s)return s}return null}function un(r){for(let e=r.length-1;e>=0;e--)try{let s=cn(r[e]);if(s)return s}catch(s){s instanceof Error?u.debug("WORKER","Skipping malformed transcript line",{lineIndex:e},s):u.debug("WORKER","Skipping malformed transcript line",{lineIndex:e,error:String(s)});continue}return""}function ln(r){try{if(!(0,Re.existsSync)(r))return{assistantMessage:""};let e=(0,Re.readFileSync)(r,"utf-8").trim();if(!e)return{assistantMessage:""};let s=e.split(`
`).filter(n=>n.trim());return{assistantMessage:un(s)}}catch(e){return e instanceof Error?u.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e):u.warn("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r,error:String(e)}),{assistantMessage:""}}}function Jt(r,e,s,t){if(!e.showLastMessage||r.length===0)return{assistantMessage:""};let n=r.find(d=>d.memory_session_id!==s);if(!n)return{assistantMessage:""};let o=n.memory_session_id,i=dn(t),a=Xt.default.join(B,"projects",i,`${o}.jsonl`);return ln(a)}function Qt(r,e){let s=e[0]?.id;return r.map((t,n)=>{let o=n===0?null:e[n+1];return{...t,displayEpoch:o?o.created_at_epoch:t.created_at_epoch,displayTime:o?o.created_at:t.created_at,shouldShowLink:t.id!==s}})}function zt(r,e){let s=[...r.map(t=>({type:"observation",data:t})),...e.map(t=>({type:"summary",data:t}))];return s.sort((t,n)=>{let o=t.type==="observation"?t.data.created_at_epoch:t.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),s}function Zt(r,e){return new Set(r.slice(0,e).map(s=>s.id))}function ts(){let r=new Date,e=r.toLocaleDateString("en-CA"),s=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),t=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${s} ${t}`}function ss(r){return[`# [${r}] recent context, ${ts()}`,""]}function rs(){return[`Legend: \u{1F3AF}session ${M.getInstance().getActiveMode().observation_types.map(s=>`${s.emoji}${s.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function ns(r,e){let s=[],t=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString("en-US")}t indexed)`,`${r.totalDiscoveryTokens.toLocaleString("en-US")}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?t.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&t.push(`${r.savings.toLocaleString("en-US")}t saved`)),s.push(`Stats: ${t.join(" | ")}`),s.push(""),s}function ze(r,e=new Date){let s=new Date(r);if(Number.isNaN(s.getTime()))return null;let t=i=>Date.UTC(i.getFullYear(),i.getMonth(),i.getDate()),n=Math.round((t(e)-t(s))/864e5);return n<=0?"today":n===1?"yesterday":n<7?`${n} days ago`:n<14?"last week":n<60?`${n} days ago`:`~${Math.round(n/30)} months ago`}function os(r){let e=ze(r);return[e?`### ${r} (${e})`:`### ${r}`]}function is(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function as(r,e,s){let t=r.title||"Untitled",n=M.getInstance().getTypeIcon(r.type),o=e?is(e):'"';return`${r.id} ${o} ${n} ${t}`}function ds(r,e,s,t){let n=[],o=r.title||"Untitled",i=M.getInstance().getTypeIcon(r.type),a=e?is(e):'"',{readTokens:d,discoveryDisplay:c}=se(r,t);n.push(`**${r.id}** ${a} ${i} **${o}**`),s&&n.push(s);let l=[];return t.showReadTokens&&l.push(`~${d}t`),t.showWorkTokens&&l.push(c),l.length>0&&n.push(l.join(" ")),n.push(""),n}function cs(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}var es=200;function re(r,e){if(!e)return[];let s=e.length>es?`${e.slice(0,es).trimEnd()}\u2026`:e;return[`**${r}**: ${s}`,""]}function us(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function ls(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function ps(r){return`# [${r}] recent context, ${ts()}

No previous sessions found.`}function _s(){let r=new Date,e=r.toLocaleDateString("en-CA"),s=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),t=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${s} ${t}`}function ms(r){return["",`${p.bright}${p.cyan}[${r}] recent context, ${_s()}${p.reset}`,`${p.gray}${"\u2500".repeat(60)}${p.reset}`,""]}function Es(){let e=M.getInstance().getActiveMode().observation_types.map(s=>`${s.emoji} ${s.id}`).join(" | ");return[`${p.dim}Legend: session-request | ${e}${p.reset}`,""]}function gs(){return[`${p.bright}Column Key${p.reset}`,`${p.dim}  Read: Tokens to read this observation (cost to learn it now)${p.reset}`,`${p.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${p.reset}`,""]}function fs(){return[`${p.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${p.reset}`,"",`${p.dim}When you need implementation details, rationale, or debugging context:${p.reset}`,`${p.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${p.reset}`,`${p.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${p.reset}`,`${p.dim}  - Trust this index over re-reading code for past decisions and learnings${p.reset}`,""]}function Ts(r,e){let s=[];if(s.push(`${p.bright}${p.cyan}Context Economics${p.reset}`),s.push(`${p.dim}  Loading: ${r.totalObservations} observations (${r.totalReadTokens.toLocaleString()} tokens to read)${p.reset}`),s.push(`${p.dim}  Work investment: ${r.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${p.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let t="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?t+=`${r.savings.toLocaleString()} tokens (${r.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?t+=`${r.savings.toLocaleString()} tokens`:t+=`${r.savingsPercent}% reduction from reuse`,s.push(`${p.green}${t}${p.reset}`)}return s.push(""),s}function bs(r){return[`${p.bright}${p.cyan}${r}${p.reset}`,""]}function hs(r){return[`${p.dim}${r}${p.reset}`]}function Ss(r,e,s,t){let n=r.title||"Untitled",o=M.getInstance().getTypeIcon(r.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=se(r,t),c=s?`${p.dim}${e}${p.reset}`:" ".repeat(e.length),l=t.showReadTokens&&i>0?`${p.dim}(~${i}t)${p.reset}`:"",_=t.showWorkTokens&&a>0?`${p.dim}(${d} ${a.toLocaleString()}t)${p.reset}`:"";return`  ${p.dim}#${r.id}${p.reset}  ${c}  ${o}  ${n} ${l} ${_}`}function Ns(r,e,s,t,n){let o=[],i=r.title||"Untitled",a=M.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:c,workEmoji:l}=se(r,n),_=s?`${p.dim}${e}${p.reset}`:" ".repeat(e.length),m=n.showReadTokens&&d>0?`${p.dim}(~${d}t)${p.reset}`:"",g=n.showWorkTokens&&c>0?`${p.dim}(${l} ${c.toLocaleString()}t)${p.reset}`:"";return o.push(`  ${p.dim}#${r.id}${p.reset}  ${_}  ${a}  ${p.bright}${i}${p.reset}`),t&&o.push(`    ${p.dim}${t}${p.reset}`),(m||g)&&o.push(`    ${m} ${g}`),o.push(""),o}function Rs(r,e){let s=`${r.request||"Session started"} (${e})`;return[`${p.yellow}#S${r.id}${p.reset} ${s}`,""]}function ne(r,e,s){return e?[`${s}${r}:${p.reset} ${e}`,""]:[]}function Is(r){return r.assistantMessage?["","---","",`${p.bright}${p.magenta}Previously${p.reset}`,"",`${p.dim}A: ${r.assistantMessage}${p.reset}`,""]:[]}function Os(r,e){let s=Math.round(r/1e3);return["",`${p.dim}Access ${s}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use get_observations([IDs]) or the mem-search skill.${p.reset}`]}function As(r){return`
${p.bright}${p.cyan}[${r}] recent context, ${_s()}${p.reset}
${p.gray}${"\u2500".repeat(60)}${p.reset}

${p.dim}No previous sessions found for this project yet.${p.reset}
`}function ys(r,e,s,t){let n=[];return t?n.push(...ms(r)):n.push(...ss(r)),t?n.push(...Es()):n.push(...rs()),t&&(n.push(...gs()),n.push(...fs())),Ne(s)&&(t?n.push(...Ts(e,s)):n.push(...ns(e,s))),n}function Ds(r){if(!r||r.length===0)return[];let e=[];for(let s of r){let t=(s.created_at??"").slice(0,10),n=ze(t),o=n?`${t} \xB7 ${n}`:t,i=null;try{let a=s.metadata?JSON.parse(s.metadata):null;a&&typeof a.focus=="string"&&a.focus.trim()&&(i=a.focus.trim())}catch{}e.push(`# \u23F3 CHECKPOINT \u2014 ${s.project} (${o})`),e.push("Curated hand-off from the previous session. Resume from here before anything else."),i&&e.push(`_Focus: ${i}_`),e.push(""),s.narrative&&s.narrative.trim()&&(e.push(s.narrative.trim()),e.push("")),e.push("---"),e.push("")}return e}var x=require("node:fs"),Ze=require("node:path");var pn="curated-import-state.json",oe=1;function _n(r){return(0,Ze.join)(r,pn)}function mn(r){let e=_n(r);if(!(0,x.existsSync)(e))return{version:oe,projects:{}};try{let s=JSON.parse((0,x.readFileSync)(e,"utf8"));return s?.version!==oe?{version:oe,projects:{}}:{version:oe,projects:s.projects??{}}}catch(s){return u.warn("DB","Curated import state unreadable \u2014 treating as absent",{path:e},s instanceof Error?s:void 0),{version:oe,projects:{}}}}function Cs(r=N){return Object.values(mn(r).projects)}function En(r){let e=0,s=0,t=[r];for(;t.length>0;){let n=t.pop(),o;try{o=(0,x.readdirSync)(n,{withFileTypes:!0}),s=Math.max(s,(0,x.statSync)(n).mtimeMs)}catch{continue}for(let i of o){let a=(0,Ze.join)(n,i.name);if(i.isDirectory()){t.push(a);continue}if(i.isFile()){e+=1;try{s=Math.max(s,(0,x.statSync)(a).mtimeMs)}catch{}}}}return{files:e,newest:s}}function vs(r){return r.map(e=>{let s=!1;try{s=(0,x.statSync)(e.path).isDirectory()}catch{s=!1}if(!s)return{path:e.path,kind:e.kind,files:0,newestMtimeEpoch:0,present:!1};let{files:t,newest:n}=En(e.path);return{path:e.path,kind:e.kind,files:t,newestMtimeEpoch:Math.round(n),present:!0}})}function Ls(r,e){if(!r||r.lastSuccessEpoch===null)return{stale:!0,reason:"never imported successfully"};if(!r.indexed)return{stale:!0,reason:"the last import was not indexed \u2014 its records are not searchable"};let s=new Map(r.sources.map(t=>[t.path,t]));for(let t of e){let n=s.get(t.path);if(!n)return{stale:!0,reason:`a source was added: ${t.path}`};if(!t.present)return{stale:!0,reason:`a source is missing: ${t.path}`};if(t.files!==n.files)return{stale:!0,reason:`${t.path} holds ${t.files} file(s), ${n.files} at the last import`};if(t.newestMtimeEpoch>n.newestMtimeEpoch)return{stale:!0,reason:`${t.path} was changed after the last import`}}for(let t of r.sources)if(!e.some(n=>n.path===t.path))return{stale:!0,reason:`a source was removed from the configuration: ${t.path}`};return{stale:!1,reason:null}}var H=require("node:fs"),Ae=require("node:path");var tt=require("node:path");var xs="settings.json",Ms="curatedSources",ie="KEEPMIND_CURATED_SOURCES";function et(r,e){if(!Array.isArray(r))return e.push({entry:r,reason:`expected an array, got ${typeof r}`}),[];let s=[];for(let t of r){if(typeof t!="object"||t===null){e.push({entry:t,reason:"not an object"});continue}let n=t,o=n.path,i=n.kind;if(typeof o!="string"||o.trim().length===0){e.push({entry:t,reason:"missing `path`"});continue}if(i!=="akten"&&i!=="vorgaenge"){e.push({entry:t,reason:`\`kind\` must be "akten" or "vorgaenge", got ${JSON.stringify(i)}`});continue}if(!(0,Ae.isAbsolute)(o)){e.push({entry:t,reason:`\`path\` must be absolute: ${o}`});continue}let a=n.project;if(a!==void 0&&(typeof a!="string"||a.trim().length===0)){e.push({entry:t,reason:`\`project\` must be a non-empty string when given, got ${JSON.stringify(a)}`});continue}s.push({path:(0,Ae.resolve)(o),kind:i,...a?{project:a.trim()}:{}})}return s}function Ps(r,e){let s=new Map;for(let t of r){let n=t.project??e,o=s.get(n);o?o.push(t):s.set(n,[t])}return s}function ws(r=N){let e=[],s=process.env[ie];if(s&&s.trim().length>0){let n=s.trim();try{return n.startsWith("[")?{sources:et(JSON.parse(n),e),origin:`${ie} (inline)`,rejected:e}:(0,H.existsSync)(n)?{sources:et(JSON.parse((0,H.readFileSync)(n,"utf8")),e),origin:n,rejected:e}:(e.push({entry:n,reason:`${ie} is neither JSON nor an existing file`}),{sources:[],origin:ie,rejected:e})}catch(o){return e.push({entry:n,reason:`unreadable: ${o instanceof Error?o.message:o}`}),{sources:[],origin:ie,rejected:e}}}let t=(0,tt.join)(r,xs);if(!(0,H.existsSync)(t))return{sources:[],origin:t,rejected:e};try{let n=JSON.parse((0,H.readFileSync)(t,"utf8"));return Ms in n?{sources:et(n[Ms],e),origin:t,rejected:e}:{sources:[],origin:t,rejected:e}}catch(n){return u.warn("DB","Could not read curated source set",{settingsPath:t},n instanceof Error?n:void 0),e.push({entry:t,reason:`unreadable: ${n instanceof Error?n.message:n}`}),{sources:[],origin:t,rejected:e}}}function ks(r=N){let e=D("KEEPMIND_CURATED_PROJECT");if(e&&e.trim().length>0)return e.trim();let s=(0,tt.join)(r,xs);if(!(0,H.existsSync)(s))return null;try{let t=JSON.parse((0,H.readFileSync)(s,"utf8")),n=t.env??t,o=G("KEEPMIND_CURATED_PROJECT",n);return typeof o=="string"&&o.trim().length>0?o.trim():null}catch{return null}}function Us(r=N){let e=new Map;for(let i of Cs(r))e.set(i.project,i);let s=ws(r),t=new Map;if(s.sources.length>0){let i=s.sources.filter(d=>d.project);for(let[d,c]of Ps(i,"(unattributed)"))d!=="(unattributed)"&&t.set(d,c);let a=s.sources.filter(d=>!d.project);if(a.length>0){let d=ks(r),c=d?[d]:e.size>0?[...e.keys()]:[];for(let l of c)t.set(l,[...t.get(l)??[],...a]);c.length===0&&t.set("(no project configured)",a)}}let n=new Set([...e.keys(),...t.keys()]),o=[];for(let i of n){let a=e.get(i)??null,d=t.get(i)??[],c=d.length>0?Ls(a,vs(d)):{stale:a===null||a.lastSuccessEpoch===null,reason:a?null:"never imported"};o.push({project:i,lastSuccessEpoch:a?.lastSuccessEpoch??null,lastAttemptEpoch:a?.lastAttemptEpoch??0,records:a?.records??0,edges:a?.edges??0,indexed:a?.indexed??!1,failure:a?.failure??null,stale:c.stale,staleReason:c.reason,ok:a!==null&&a.lastSuccessEpoch!==null&&a.indexed&&!a.failure&&!c.stale,sources:d})}return o.sort((i,a)=>i.project.localeCompare(a.project))}function gn(r,e=Date.now()){if(r.lastSuccessEpoch===null)return"never";let s=new Date(r.lastSuccessEpoch).toISOString().slice(0,10),t=Math.floor((e-r.lastSuccessEpoch)/864e5);return t<=0?`${s} \xB7 today`:t===1?`${s} \xB7 yesterday`:`${s} \xB7 ${t} days ago`}function ye(r,e=Date.now()){let s=gn(r,e);if(r.ok)return`last imported ${s} \xB7 ${r.records} record(s), ${r.edges} relation(s) \xB7 index in sync`;let t=new Set;return r.lastSuccessEpoch===null&&t.add("never imported successfully"),r.failure&&t.add(r.failure),r.indexed||t.add("NOT in the semantic index \u2014 semantic search cannot see these records"),r.stale&&r.staleReason&&t.add(r.staleReason),`last imported ${s} \u2014 ${[...t].join("; ")}`}function Fs(r={}){let e=r.now??Date.now(),s;try{s=r.entries??Us()}catch(i){return u.debug("WORKER","Curated health could not be read",{},i instanceof Error?i:void 0),[]}if(s.length===0)return[];let t=s.filter(i=>!i.ok),n=[];if(t.length===0){for(let i of s)n.push(`Curated corpus [${i.project}]: ${ye(i,e)}`);return n.push(""),n}n.push("# \u26A0 CURATED CORPUS OUT OF STEP"),n.push("The lasting entries below are not in step with their source files. Answers drawn from them may be out of date."),n.push("");for(let i of t)n.push(`- **${i.project}** \u2014 ${ye(i,e)}`);let o=s.filter(i=>i.ok);for(let i of o)n.push(`- ${i.project} \u2014 ${ye(i,e)}`);return n.push(""),n.push("Fix it with `npx keepmind curated:import` (add `--project <name>`), then `npx keepmind doctor`."),n.push(""),n.push("---"),n.push(""),n}var De=V(require("path"),1);function Ce(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return u.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e instanceof Error?e:new Error(String(e))),[]}}function st(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function rt(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function js(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function $s(r,e){return De.default.isAbsolute(r)?De.default.relative(e,r).split(De.default.sep).join("/"):r}function Hs(r,e,s){let t=Ce(r);if(t.length>0)return $s(t[0],e);if(s){let n=Ce(s);if(n.length>0)return $s(n[0],e)}return"General"}function fn(r){let e=new Map;for(let t of r){let n=t.type==="observation"?t.data.created_at:t.data.displayTime,o=js(n);e.has(o)||e.set(o,[]),e.get(o).push(t)}let s=Array.from(e.entries()).sort((t,n)=>{let o=new Date(t[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(s)}function Ks(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?Ce(r.facts).join(`
`):null}function Tn(r,e,s,t){let n=[];n.push(...os(r));let o="";for(let i of e)if(i.type==="summary"){let a=i.data,d=st(a.displayTime);n.push(...cs(a,d))}else{let a=i.data,d=rt(a.created_at),l=d!==o?d:"";if(o=d,s.has(a.id)){let m=Ks(a,t);n.push(...ds(a,l,m,t))}else n.push(as(a,l,t))}return n}function bn(r,e,s,t,n){let o=[];o.push(...bs(r));let i=null,a="";for(let d of e)if(d.type==="summary"){i=null,a="";let c=d.data,l=st(c.displayTime);o.push(...Rs(c,l))}else{let c=d.data,l=Hs(c.files_modified,n,c.files_read),_=rt(c.created_at),m=_!==a;a=_;let g=s.has(c.id);if(l!==i&&(o.push(...hs(l)),i=l),g){let f=Ks(c,t);o.push(...Ns(c,_,m,f,t))}else o.push(Ss(c,_,m,t))}return o.push(""),o}function hn(r,e,s,t,n,o){return o?bn(r,e,s,t,n):Tn(r,e,s,t)}function Gs(r,e,s,t,n){let o=[],i=fn(r);for(let[a,d]of i)o.push(...hn(a,d,e,s,t,n));return o}function Bs(r,e,s){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||s&&e.created_at_epoch<=s.created_at_epoch)}function Xs(r,e){let s=[];return e?(s.push(...ne("Investigated",r.investigated,p.blue)),s.push(...ne("Learned",r.learned,p.yellow)),s.push(...ne("Completed",r.completed,p.green)),s.push(...ne("Next Steps",r.next_steps,p.magenta))):(s.push(...re("Investigated",r.investigated)),s.push(...re("Learned",r.learned)),s.push(...re("Completed",r.completed)),s.push(...re("Next Steps",r.next_steps))),s}function Ws(r,e){return e?Is(r):us(r)}function Vs(r,e,s){return!Ne(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:s?Os(r.totalDiscoveryTokens,r.totalReadTokens):ls(r.totalDiscoveryTokens,r.totalReadTokens)}var Sn=Ys.default.join((0,qs.homedir)(),".claude","plugins","marketplaces","keepmind","plugin",".install-version");function Nn(){try{return new ge}catch(r){if(r instanceof Error&&r.code==="ERR_DLOPEN_FAILED"){try{(0,Js.unlinkSync)(Sn)}catch(e){e instanceof Error?u.debug("WORKER","Marker file cleanup failed (may not exist)",{},e):u.debug("WORKER","Marker file cleanup failed (may not exist)",{error:String(e)})}return u.error("WORKER","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function Rn(r,e){return e?As(r):ps(r)}function In(r,e,s,t,n,o,i,a){let d=[],c=Qe(e);d.push(...ys(r,c,n,a)),d.push(...Fs()),d.push(...Ds(t));let l=s.slice(0,n.sessionCount),_=Qt(l,s),m=zt(e,_),g=Zt(e,n.fullObservationCount);d.push(...Gs(m,g,n,o,a));let f=s[0],R=e[0];Bs(n,f,R)&&d.push(...Xs(f,a));let O=Jt(e,n,i,o);return d.push(...Ws(O,a)),d.push(...Vs(c,n,a)),d.join(`
`).trimEnd()}var On=new Set(["bugfix","discovery","decision","refactor","security_alert","security_note"]);function An(r,e,s){let t=Qe(r),n={bugfix:0,discovery:0,decision:0,refactor:0,security_alert:0,security_note:0,other:0},o=new Set,i=Number.POSITIVE_INFINITY;for(let d of r){let c=On.has(d.type)?d.type:"other";n[c]++,d.memory_session_id&&o.add(d.memory_session_id),d.created_at_epoch&&d.created_at_epoch<i&&(i=d.created_at_epoch)}let a=Number.isFinite(i)?Math.max(0,Math.floor((Date.now()-i)/864e5)):0;return{observation_count:r.length,session_count:o.size,timeline_depth_days:a,has_session_summary:e.length>0,obs_type_bugfix:n.bugfix,obs_type_discovery:n.discovery,obs_type_decision:n.decision,obs_type_refactor:n.refactor,obs_type_security_alert:n.security_alert,obs_type_security_note:n.security_note,obs_type_other:n.other,tokens_injected:t.totalReadTokens,tokens_saved_vs_naive:t.savings,search_strategy:s?"full":"timeline"}}async function nt(r,e=!1){let s=Gt(),t=pe(),n=r?.cwd??process.cwd(),o=jt(n),i=r?.projects?.length?r.projects:o.allProjects,a=i[i.length-1]??o.primary,d=t.importance.enabled&&!r?.full,c=s.totalObservationCount;d&&(s.totalObservationCount=Math.max(c,c*Math.max(1,t.injection.candidateMultiplier))),r?.full&&(s.totalObservationCount=999999,s.sessionCount=999999);let l=Nn();if(!l)return{text:"",stats:null};try{let _=r?.platformSource?C(r.platformSource):void 0,m=i.length>1?Yt(l,i,s,_):Wt(l,a,s,_),g=d?Bt(m,{tokenBudget:t.injection.tokenBudget,halfLifeDays:t.importance.halfLifeDays,maxRows:c}):m,f=i.length>1?qt(l,i,s,_):Vt(l,a,s,_),R=l.getActiveCheckpoints(i);return g.length>0&&l.markObservationsUsed(g.map(h=>h.id),"injection"),g.length===0&&f.length===0&&R.length===0?{text:Rn(a,e),stats:null}:{text:In(a,g,f,R,s,n,r?.session_id,e),stats:An(g,f,!!r?.full)}}finally{l.close()}}async function Qs(r,e=!1){return(await nt(r,e)).text}0&&(module.exports={generateContext,generateContextWithStats});
