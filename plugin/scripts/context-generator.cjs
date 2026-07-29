"use strict";var Rs=Object.create;var z=Object.defineProperty;var Is=Object.getOwnPropertyDescriptor;var Ns=Object.getOwnPropertyNames;var Os=Object.getPrototypeOf,As=Object.prototype.hasOwnProperty;var ys=(r,e)=>{for(var t in e)z(r,t,{get:e[t],enumerable:!0})},Ke=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of Ns(e))!As.call(r,n)&&n!==t&&z(r,n,{get:()=>e[n],enumerable:!(s=Is(e,n))||s.enumerable});return r};var B=(r,e,t)=>(t=r!=null?Rs(Os(r)):{},Ke(e||!r||!r.__esModule?z(t,"default",{value:r,enumerable:!0}):t,r)),Ds=r=>Ke(z({},"__esModule",{value:!0}),r);var Fr={};ys(Fr,{generateContext:()=>hs,generateContextWithStats:()=>Xe});module.exports=Ds(Fr);var fs=B(require("path"),1),bs=require("os"),Ss=require("fs");var Ye=require("node:sqlite");function We(r){return typeof r=="bigint"?Number(r):r}function vs(r){return r!==null&&typeof r=="object"&&!Array.isArray(r)&&!(r instanceof Uint8Array)&&!(typeof Buffer<"u"&&Buffer.isBuffer(r))}function Ve(r){return r===void 0?null:typeof r=="boolean"?r?1:0:r}function Z(r){let e=r;if(e.length===1&&Array.isArray(e[0])&&(e=e[0]),e.length===1&&vs(e[0])){let t=e[0],s={};for(let n of Object.keys(t))s[n]=Ve(t[n]);return[s]}return e.map(Ve)}var be=class{constructor(e){this.stmt=e}stmt;all(...e){return this.stmt.all(...Z(e))}get(...e){return this.stmt.get(...Z(e))??null}run(...e){let t=this.stmt.run(...Z(e));return{changes:We(t.changes),lastInsertRowid:We(t.lastInsertRowid)}}values(...e){return this.stmt.all(...Z(e)).map(s=>Object.values(s))}finalize(){}},H=class{db;queryCache=new Map;safeIntegers;txDepth=0;filename;constructor(e,t={}){let s=t.readonly===!0;this.safeIntegers=t.safeIntegers===!0;let n=e&&e.length>0?e:":memory:";if(this.filename=n,this.db=new Ye.DatabaseSync(n,{readOnly:s,allowExtension:!0}),!s&&n!==":memory:")try{this.db.exec("PRAGMA journal_mode=WAL")}catch{}}wrap(e){return this.safeIntegers&&e.setReadBigInts(!0),new be(e)}prepare(e){return this.wrap(this.db.prepare(e))}query(e){let t=this.queryCache.get(e);if(t)return t;let s=this.prepare(e);return this.queryCache.set(e,s),s}run(e,...t){return t.length===0?(this.db.exec(e),{changes:0,lastInsertRowid:0}):this.prepare(e).run(...t)}exec(e){this.db.exec(e)}loadExtension(e,t){this.db.loadExtension(e)}transaction(e){return(...t)=>{let s=this.txDepth===0,n=`__cm_sp_${this.txDepth}`;s?this.db.exec("BEGIN"):this.db.exec(`SAVEPOINT ${n}`),this.txDepth++;try{let o=e(...t);return this.txDepth--,s?this.db.exec("COMMIT"):this.db.exec(`RELEASE ${n}`),o}catch(o){throw this.txDepth--,s?this.db.exec("ROLLBACK"):(this.db.exec(`ROLLBACK TO ${n}`),this.db.exec(`RELEASE ${n}`)),o}}}close(){this.db.close()}};var T=require("path"),Oe=require("os"),M=require("fs");var Ze=require("url");var qe="KEEPMIND_",Je="CLAUDE_MEM_";function Qe(r){return r.startsWith(qe)?Je+r.slice(qe.length):null}function L(r,e=process.env){let t=e[r];if(t!==void 0)return t;let s=Qe(r);return s?e[s]:void 0}function ee(r,e){let t=e[r];if(t!==void 0)return t;let s=Qe(r);return s?e[s]:void 0}function ze(r){return Object.keys(r).some(e=>e.startsWith(Je))}var P=require("fs"),Re=require("path");var Cs=null;function Ls(r){return(Cs??process.stderr.write.bind(process.stderr))(r)}function Se(r){Ls(r)}var Ms=14,Ie=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(Ie||{}),he=null,xs=6e4,Ps=500,j=new Map;function ws(r,e,t,s){let n=`${r}|${e}|${t}`,o=j.get(n);if(o&&s-o.windowStartedAt<xs)return o.suppressed++,null;if(!o&&j.size>=Ps){let d=j.keys().next();d.done||j.delete(d.value)}let i=o?.suppressed??0,a=o?Math.round((s-o.windowStartedAt)/1e3):0;return j.set(n,{windowStartedAt:s,suppressed:0}),i>0?` (repeated ${i}\xD7 in the previous ${a}s)`:""}var Ne=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=$.logsDir();(0,P.existsSync)(e)||(0,P.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,Re.join)(e,`keepmind-${t}.log`),this.pruneOldLogs(e)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e instanceof Error?e.message:String(e)),this.logFilePath=null}}}pruneOldLogs(e){try{let t=Date.now()-Ms*24*60*60*1e3;for(let s of(0,P.readdirSync)(e)){let n=/^keepmind-(\d{4}-\d{2}-\d{2})\.log$/.exec(s);if(!n)continue;let o=Date.parse(n[1]);if(Number.isFinite(o)&&o<t)try{(0,P.unlinkSync)((0,Re.join)(e,s))}catch{}}}catch{}}getLevel(){if(this.level===null)try{let e=$.settings();if((0,P.existsSync)(e)){let t=(0,P.readFileSync)(e,"utf-8"),n=(JSON.parse(t).KEEPMIND_LOG_LEVEL||"INFO").toUpperCase();this.level=Ie[n]??1}else this.level=1}catch(e){console.error("[LOGGER] Failed to load log level from settings:",e instanceof Error?e.message:String(e)),this.level=1}return this.level}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${n} ${o}:${i}:${a}.${d}`}log(e,t,s,n,o){if(e<this.getLevel())return;let i="";if(process.env.KEEPMIND_LOG_DEDUP!=="0"){let f=ws(e,t,s,Date.now());if(f===null)return;i=f}this.ensureLogFileInitialized();let a=this.formatTimestamp(new Date),d=Ie[e].padEnd(5),c=t.padEnd(6),u="";n?.correlationId?u=`[${n.correlationId}] `:n?.sessionId&&(u=`[session-${n.sessionId}] `);let _="";if(o!=null)if(o instanceof Error)_=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`;else if(this.getLevel()===0&&typeof o=="object")try{_=`
`+JSON.stringify(o,null,2)}catch{_=" "+this.formatData(o)}else _=" "+this.formatData(o);let m="";if(n){let{sessionId:f,memorySessionId:N,correlationId:O,...S}=n;Object.keys(S).length>0&&(m=` {${Object.entries(S).map(([C,b])=>`${C}=${b}`).join(", ")}}`)}let g=`[${a}] [${d}] [${c}] ${u}${s}${i}${m}${_}`;if(this.logFilePath)try{(0,P.appendFileSync)(this.logFilePath,g+`
`,"utf8")}catch(f){Se(`[LOGGER] Failed to write to log file: ${f instanceof Error?f.message:String(f)}
`)}else Se(g+`
`)}debug(e,t,s,n){this.log(0,e,t,s,n)}info(e,t,s,n){this.log(1,e,t,s,n)}warn(e,t,s,n){this.log(2,e,t,s,n)}setErrorSink(e){he=e}error(e,t,s,n){this.log(3,e,t,s,n),this.routeErrorToSink(t,s,n)}routeErrorToSink(e,t,s){try{if(!he||!(s instanceof Error))return;he(s)}catch{}}dataIn(e,t,s,n){this.info(e,`\u2192 ${t}`,s,n)}dataOut(e,t,s,n){this.info(e,`\u2190 ${t}`,s,n)}success(e,t,s,n){this.info(e,`\u2713 ${t}`,s,n)}failure(e,t,s,n){this.error(e,`\u2717 ${t}`,s,n)}happyPathError(e,t,s,n,o=""){let c=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),u=c?`${c[1].split("/").pop()}:${c[2]}`:"unknown",_={...s,location:u};return this.warn(e,`[HAPPY-PATH] ${t}`,_,n),o}},l=new Ne;var Ws={};function ks(){return typeof __dirname<"u"?__dirname:(0,T.dirname)((0,Ze.fileURLToPath)(Ws.url))}var Us=ks();function Fs(){let r=L("KEEPMIND_DATA_DIR");if(r)return r;let e=(0,T.join)((0,Oe.homedir)(),".keepmind"),t=(0,T.join)(e,"settings.json");try{if((0,M.existsSync)(t)){let s=JSON.parse((0,M.readFileSync)(t,"utf-8")),n=s.env??s,o=ee("KEEPMIND_DATA_DIR",n);if(o)return o}}catch{}return e}var A=Fs(),G=process.env.CLAUDE_CONFIG_DIR||(0,T.join)((0,Oe.homedir)(),".claude"),qr=(0,T.join)(G,"plugins","marketplaces","keepmind"),$s=(0,T.join)(A,"archives"),Gs=(0,T.join)(A,"logs"),Bs=(0,T.join)(A,"trash"),Hs=(0,T.join)(A,"backups"),js=(0,T.join)(A,"modes"),Jr=(0,T.join)(A,"settings.json"),U=(0,T.join)(A,"keepmind.db"),X=(0,T.join)(A,"claude-mem.db"),Xs=(0,T.join)(A,"vector-db"),et=(0,T.join)(A,"observer-sessions"),Ae=(0,T.basename)(et),Qr=(0,T.join)(G,"settings.json"),zr=(0,T.join)(G,"commands"),Zr=(0,T.join)(G,"CLAUDE.md");function tt(r){(0,M.mkdirSync)(r,{recursive:!0})}function Ks(){try{if((0,M.existsSync)(U)||!(0,M.existsSync)(X))return(0,M.existsSync)(U);for(let r of["","-wal","-shm"]){let e=X+r,t=U+r;(0,M.existsSync)(e)&&!(0,M.existsSync)(t)&&(0,M.renameSync)(e,t)}return l.info("DB","Migrated legacy claude-mem.db to keepmind.db",{from:X,to:U}),!0}catch(r){return l.warn("DB","Could not rename legacy claude-mem.db to keepmind.db (file may be locked) \u2014 falling back to legacy path",{},r instanceof Error?r:new Error(String(r))),!1}}function ye(){return Ks(),!(0,M.existsSync)(U)&&(0,M.existsSync)(X)?X:U}function st(){return(0,T.join)(Us,"..")}var $={dataDir:()=>A,workerPid:()=>(0,T.join)(A,"worker.pid"),workerPort:()=>(0,T.join)(A,"worker.port"),serverPid:()=>(0,T.join)(A,".server-beta.pid"),serverPort:()=>(0,T.join)(A,".server-beta.port"),serverRuntime:()=>(0,T.join)(A,".server-beta.runtime.json"),settings:()=>(0,T.join)(A,"settings.json"),database:()=>ye(),chroma:()=>(0,T.join)(A,"chroma"),combinedCerts:()=>(0,T.join)(A,"combined_certs.pem"),transcriptsConfig:()=>(0,T.join)(A,"transcript-watch.json"),transcriptsState:()=>(0,T.join)(A,"transcript-watch-state.json"),corpora:()=>(0,T.join)(A,"corpora"),supervisorRegistry:()=>(0,T.join)(A,"supervisor.json"),envFile:()=>(0,T.join)(A,".env"),logsDir:()=>Gs,archives:()=>$s,trash:()=>Bs,backups:()=>Hs,modes:()=>js,vectorDb:()=>Xs,observerSessions:()=>et};var rt={injection:"injection_count",explicit_fetch:"explicit_fetch_count",fts:"fts_hit_count",vector:"vector_hit_count"};var nt=require("crypto");function De(r,e,t){return(0,nt.createHash)("sha256").update([r||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function ve(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[String(e)]}catch{return[r]}}var Ce=r=>`\xABredacted:${r}\xBB`,Vs=[{type:"PRIVATE_KEY",re:/-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,4000}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g},{type:"CONNECTION_STRING",re:/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]{1,200}/gi},{type:"AWS_KEY",re:/\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g},{type:"GITHUB_FINE_PAT",re:/\bgithub_pat_\w{82}\b/g},{type:"GITHUB_PAT",re:/\bghp_[0-9A-Za-z]{36}\b/g},{type:"GITLAB_PAT",re:/\bglpat-[\w-]{20}\b/g},{type:"SLACK_TOKEN",re:/\bxox[baprs]-[0-9A-Za-z-]{10,200}\b/g},{type:"GOOGLE_API_KEY",re:/\bAIza[\w-]{35}\b/g},{type:"STRIPE_KEY",re:/\b(?:sk|rk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}\b/g},{type:"JWT",re:/\bey[A-Za-z0-9_-]{17,500}\.ey[A-Za-z0-9_/\\-]{17,500}\.[A-Za-z0-9_/\\-]{10,500}={0,2}/g},{type:"BEARER",re:/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,500}/g},{type:"BCRYPT",re:/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g},{type:"GENERIC_SECRET",re:/(?:pass(?:word)?|secret|token|api[_-]?key|client[_-]?secret|auth)\b['"\s]{0,3}[:=>]{1,2}['"\s]{0,3}([\w./+=-]{10,150})/gi,group:1}];function Ys(r,e){if(e.re.lastIndex=0,e.group===void 0)return r.replace(e.re,Ce(e.type));let t=e.group;return r.replace(e.re,(s,...n)=>{let o=n[t-1];return typeof o!="string"||o.length===0?s:s.replace(o,Ce(e.type))})}function qs(r){if(r.length===0)return 0;let e=new Map;for(let s of r)e.set(s,(e.get(s)??0)+1);let t=0;for(let s of e.values()){let n=s/r.length;t-=n*Math.log2(n)}return t}var Js=/^[0-9a-f]+$/i;function Qs(r,e){return r.length<20||r.length>200||/[\s]/.test(r)||!/\d/.test(r)||!/[A-Za-z]/.test(r)||r.includes("/")||r.includes("\\")||r.length<=64&&Js.test(r)||r.includes("redacted:")?!1:qs(r)>=e}var zs=/([\s"'`,;(){}\[\]<>]+)/;function Zs(r,e){let t=r.split(zs);for(let s=0;s<t.length;s++){let n=t[s];n&&Qs(n,e)&&(t[s]=Ce("HIGH_ENTROPY"))}return t.join("")}function Le(r,e={}){if(typeof r!="string"||r.length===0)return r;try{let t=r;for(let s of Vs)t=Ys(t,s);return e.entropySweep!==!1&&(t=Zs(t,e.entropyThreshold??4)),t}catch{return r}}function te(r,e={}){if(typeof r=="string")return Le(r,e);if(Array.isArray(r))return r.map(t=>te(t,e));if(r&&typeof r=="object"){let t={};for(let[s,n]of Object.entries(r))t[s]=te(n,e);return t}return r}var re=require("fs");var xe={redactSecrets:{enabled:!0,entropyThreshold:4,entropySweep:!0},scoping:{enabled:!0,includeGlobal:!0,defaultSearchScope:"project"},importance:{enabled:!0,halfLifeDays:14,llmRefine:!1},injection:{tokenBudget:1e3,candidateMultiplier:3},reconcile:{enabled:!1,noopThreshold:.92,updateBand:.75,llmAdjudicate:!1,allowHardDelete:!1},supersession:{enabled:!1},expiry:{enabled:!1,ttlDays:28,importanceFloor:7,hardDelete:!1},vectorRetention:{enabled:!0,inactiveDays:90},optimizer:{enabled:!0,tickMinutes:5,vacuumHours:24}};function se(r){return!!r&&typeof r=="object"&&!Array.isArray(r)}function F(r,e){if(!se(e))return{...r};let t={...r};for(let s of Object.keys(r))e[s]!==void 0&&typeof e[s]==typeof r[s]&&(t[s]=e[s]);return t}var Me=null;function ne(r=!1){if(Me&&!r)return Me;let e=xe,t;try{let o=$.settings();if((0,re.existsSync)(o)){let i=JSON.parse((0,re.readFileSync)(o,"utf-8").replace(/^﻿/,"")),a=se(i)?i.memoryQuality??(se(i.env)?i.env.memoryQuality:void 0):void 0;se(a)&&(t=a)}}catch(o){l.debug("CONFIG","memoryQuality config load failed; using defaults",{},o instanceof Error?o:new Error(String(o)))}let s={redactSecrets:F(e.redactSecrets,t?.redactSecrets),scoping:F(e.scoping,t?.scoping),importance:F(e.importance,t?.importance),injection:F(e.injection,t?.injection),reconcile:F(e.reconcile,t?.reconcile),supersession:F(e.supersession,t?.supersession),expiry:F(e.expiry,t?.expiry),vectorRetention:F(e.vectorRetention,t?.vectorRetention),optimizer:F(e.optimizer,t?.optimizer)},n=L("KEEPMIND_REDACT_SECRETS");return(n==="0"||n==="false")&&(s.redactSecrets.enabled=!1),Me=s,s}var er={decision:9,bugfix:8,refactor:6,discovery:5,global:7,other:3,trivial:1};function tr(r){if(Array.isArray(r))return r.length;if(typeof r=="string")try{let e=JSON.parse(r);return Array.isArray(e)?e.length:0}catch{return 0}return 0}function Pe(r){let e=er[r.type??"other"]??4;return tr(r.files_modified)>0&&(e+=1),(r.narrative?.length??0)<40&&(e-=1),/\b(TODO|FIXME|WIP)\b/i.test(r.narrative??"")&&(e-=1),Math.max(1,Math.min(10,e))}var sr=14,rr=864e5;function ot(r,e={}){let t=e.now??Date.now(),s=(e.halfLifeDays??sr)*rr,n=(r.importance??5)/10,o=Math.max(0,t-(r.created_at_epoch??t)),i=Math.pow(.5,o/s);return n*i}var nr=new Set(["the","a","an","and","or","but","to","of","in","on","for","with","is","are","was","were","be","been","it","this","that","we","i","as","at","by","from","into","over","so","then","than","will"]);function oe(r){return r?r.toLowerCase().replace(/[^a-z0-9\s]+/g," ").split(/\s+/).filter(e=>e.length>0&&!nr.has(e)).join(" ").trim():""}function it(r){let e=new Set,t=r.replace(/\s+/g," ");for(let s=0;s+3<=t.length;s++)e.add(t.slice(s,s+3));return e}function or(r,e){let t=it(r),s=it(e);if(t.size===0&&s.size===0)return 1;if(t.size===0||s.size===0)return 0;let n=0;for(let o of t)s.has(o)&&n++;return n/(t.size+s.size-n)}function ir(r,e){let t=new Map,s=new Map;for(let a of r.split(" "))a&&t.set(a,(t.get(a)??0)+1);for(let a of e.split(" "))a&&s.set(a,(s.get(a)??0)+1);if(t.size===0||s.size===0)return 0;let n=0;for(let[a,d]of t)n+=d*(s.get(a)??0);let o=0;for(let a of t.values())o+=a*a;let i=0;for(let a of s.values())i+=a*a;return n/(Math.sqrt(o)*Math.sqrt(i)||1)}function ar(r,e){let t=oe(`${r??""}`),s=oe(`${e??""}`);return Math.max(or(t,s),ir(t,s))}function at(r,e,t){let s=`${r.title??""} ${r.narrative??""}`,n={action:"ADD"},o=-1;for(let i of e){let a=ar(s,`${i.title??""} ${i.narrative??""}`);a<=o||(o=a,a>=t.noopThreshold?n={action:"NOOP",candidateId:i.id,score:a}:a>=t.updateBand&&t.supersessionEnabled?n={action:"UPDATE",candidateId:i.id,score:a}:n={action:"ADD",score:a})}return n}var dt=require("crypto");function we(r){let e=r.title??"";if(!e){if(Array.isArray(r.facts)&&r.facts.length>0)e=r.facts[0];else if(typeof r.facts=="string")try{let s=JSON.parse(r.facts);Array.isArray(s)&&s.length>0&&(e=String(s[0]))}catch{}}e||(e=(r.narrative??"").slice(0,80));let t=oe(e);return(0,dt.createHash)("sha1").update(t).digest("hex").slice(0,16)}var E="claude";function dr(r){return r.trim().toLowerCase().replace(/\s+/g,"-")}function D(r){if(!r)return E;let e=dr(r);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e:E}function ct(r){let e=["claude","codex","cursor"];return[...r].sort((t,s)=>{let n=e.indexOf(t),o=e.indexOf(s);return n!==-1||o!==-1?n===-1?1:o===-1?-1:n-o:t.localeCompare(s)})}function ut(r,e,t,s,n){let o=Date.now()-s,i=n!==void 0?"up.session_db_id = ?":"up.content_session_id = ?",a=n??e;return r.prepare(`
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
  `).get(a,t,o)??void 0}var _t=["private","keepmind-context","claude-mem-context","system_instruction","system-instruction","persisted-output","system-reminder"],lt=new RegExp(`<(${_t.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>`,"g"),mt=/<system-reminder>[\s\S]*?<\/system-reminder>/g,pt=100;function cr(r){let e=Object.fromEntries(_t.map(n=>[n,0]));lt.lastIndex=0;let t=0,s=r.replace(lt,(n,o)=>(e[o]=(e[o]??0)+1,t+=1,""));return t>pt&&l.warn("SYSTEM","tag count exceeds limit",void 0,{tagCount:t,maxAllowed:pt,contentLength:r.length}),{stripped:s.trim(),counts:e}}function Et(r){return cr(r).stripped}var ur=["task-notification"],bn=new RegExp(`^\\s*<(${ur.join("|")})\\b[^>]*>(?:(?!<\\1\\b|</\\1\\b)[\\s\\S])*</\\1>\\s*$`),Sn=256*1024;var ke=4e3;function ie(r){let e=r.trim(),s=Et(r).trim()||e;return s.length<=ke?s:(l.debug("DB","Truncated stored prompt text to the configured cap",{originalLength:s.length,storedLength:ke}),`${s.slice(0,ke-1)}\u2026`)}function _r(r,e){return{customTitle:r,platformSource:e?D(e):void 0}}var ae=class{db;redactEnabled;redactOpts;mq;rt(e){return this.redactEnabled?Le(e,this.redactOpts):e}rl(e){return this.redactEnabled?te(e,this.redactOpts):e}constructor(e=U){try{this.mq=ne();let t=this.mq.redactSecrets;this.redactEnabled=t.enabled,this.redactOpts={entropySweep:t.entropySweep,entropyThreshold:t.entropyThreshold}}catch{this.mq=xe,this.redactEnabled=L("KEEPMIND_REDACT_SECRETS")!=="0"&&L("KEEPMIND_REDACT_SECRETS")!=="false",this.redactOpts={entropySweep:!0,entropyThreshold:4}}if(e instanceof H)this.db=e;else{e!==":memory:"&&tt(A);let t=e===U?ye():e;this.db=new H(t),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.db.run(`PRAGMA journal_size_limit = ${4194304}`),this.db.run(`PRAGMA busy_timeout = ${5e3}`)}this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.ensureMergedIntoProjectColumns(),this.addObservationSubagentColumns(),this.addObservationsUniqueContentHashIndex(),this.addObservationsMetadataColumn(),this.dropDeadPendingMessagesColumns(),this.ensurePendingMessagesToolUseIdColumn(),this.dropWorkerPidColumn(),this.ensureSDKSessionsPlatformContentIdentity(),this.ensureUserPromptsSessionDbId(),this.ensurePendingMessagesSessionToolUniqueIndex(),this.addObservationImportanceColumn(),this.addObservationBitemporalColumns(),this.addObservationLastUsedColumn(),this.addObservationUsageChannelColumns()}addObservationUsageChannelColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(39),t=this.db.query("PRAGMA table_info(observations)").all(),s=o=>t.some(i=>i.name===o),n=["injection_count","explicit_fetch_count","fts_hit_count","vector_hit_count"];if(!(e&&n.every(s))){for(let o of n)s(o)||this.db.run(`ALTER TABLE observations ADD COLUMN ${o} INTEGER DEFAULT 0`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(39,new Date().toISOString())}}addObservationBitemporalColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(37),t=this.db.query("PRAGMA table_info(observations)").all(),s=n=>t.some(o=>o.name===n);e&&s("valid_from")&&s("valid_to")&&s("subject_key")||(s("valid_from")||this.db.run("ALTER TABLE observations ADD COLUMN valid_from INTEGER"),s("valid_to")||this.db.run("ALTER TABLE observations ADD COLUMN valid_to INTEGER"),s("subject_key")||this.db.run("ALTER TABLE observations ADD COLUMN subject_key TEXT"),this.db.run("UPDATE observations SET valid_from = created_at_epoch WHERE valid_from IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_subject_valid ON observations(project, subject_key, valid_to)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(37,new Date().toISOString()))}addObservationLastUsedColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(38),s=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="last_used_at");e&&s||(s||this.db.run("ALTER TABLE observations ADD COLUMN last_used_at INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_last_used ON observations(last_used_at)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(38,new Date().toISOString()))}addObservationImportanceColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(36),s=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="importance");e&&s||(s||this.db.run("ALTER TABLE observations ADD COLUMN importance INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(36,new Date().toISOString()))}getIndexColumns(e){return this.db.query(`PRAGMA index_info(${JSON.stringify(e)})`).all().map(t=>t.name)}hasUniqueIndexOnColumns(e,t){return this.db.query(`PRAGMA index_list(${e})`).all().some(n=>{if(n.unique!==1)return!1;let o=this.getIndexColumns(n.name);return o.length===t.length&&o.every((i,a)=>i===t[a])})}resolvePromptSessionDbId(e,t,s){if(t!==void 0)return t;let n=s?D(s):void 0;return n?this.db.prepare(`
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
    `).get(e)?.id??null}dropWorkerPidColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(32),s=this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="worker_pid");if(!(e&&!s)){if(s)try{this.db.run("DROP INDEX IF EXISTS idx_pending_messages_worker_pid"),this.db.run("ALTER TABLE pending_messages DROP COLUMN worker_pid"),l.debug("DB","Dropped worker_pid column and its index from pending_messages")}catch(n){l.warn("DB","Failed to drop worker_pid column from pending_messages",{},n instanceof Error?n:new Error(String(n)));return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(32,new Date().toISOString())}}ensureSDKSessionsPlatformContentIdentity(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(33),t=this.hasUniqueIndexOnColumns("sdk_sessions",["content_session_id"]),s=this.hasUniqueIndexOnColumns("sdk_sessions",["platform_source","content_session_id"]),o=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source");if(!(e&&!t&&s&&o)){if(o||this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${E}'`),this.db.run(`
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
        `),this.db.run("INSERT INTO user_prompts_fts(user_prompts_fts) VALUES('rebuild')")),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString()),this.db.run("COMMIT")}catch(c){throw this.db.run("ROLLBACK"),c}finally{this.db.run("PRAGMA foreign_keys = ON")}}ensurePendingMessagesSessionToolUniqueIndex(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(35);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString());return}let s=this.hasUniqueIndexOnColumns("pending_messages",["session_db_id","tool_use_id"]);if(!(e&&s)){this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP INDEX IF EXISTS ux_pending_session_tool"),this.db.run(`
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
      `),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString()),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}}}dropDeadPendingMessagesColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(31),t=this.db.query("PRAGMA table_info(pending_messages)").all(),s=new Set(t.map(i=>i.name)),o=["retry_count","failed_at_epoch","completed_at_epoch"].filter(i=>s.has(i));if(!(e&&o.length===0)){if(o.length>0){this.db.run("BEGIN TRANSACTION");try{this.db.run("DELETE FROM pending_messages WHERE status NOT IN ('pending', 'processing')");for(let i of o)this.db.run(`ALTER TABLE pending_messages DROP COLUMN ${i}`),l.debug("DB",`Dropped dead column ${i} from pending_messages`);e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString()),this.db.run("COMMIT")}catch(i){this.db.run("ROLLBACK"),l.warn("DB","Failed to drop dead columns from pending_messages",{},i instanceof Error?i:new Error(String(i)));return}return}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(31,new Date().toISOString())}}initializeSchema(){this.db.run(`
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
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(4,new Date().toISOString())}ensureWorkerPortColumn(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(s=>s.name==="worker_port")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER"),l.debug("DB","Added worker_port column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(5,new Date().toISOString())}ensurePromptTrackingColumns(){this.db.query("PRAGMA table_info(sdk_sessions)").all().some(a=>a.name==="prompt_counter")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0"),l.debug("DB","Added prompt_counter column to sdk_sessions table")),this.db.query("PRAGMA table_info(observations)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE observations ADD COLUMN prompt_number INTEGER"),l.debug("DB","Added prompt_number column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(a=>a.name==="prompt_number")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER"),l.debug("DB","Added prompt_number column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(6,new Date().toISOString())}removeSessionSummariesUniqueConstraint(){if(!this.db.query("PRAGMA index_list(session_summaries)").all().some(s=>s.unique===1&&s.origin!=="pk")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString());return}l.debug("DB","Removing UNIQUE constraint from session_summaries.memory_session_id"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS session_summaries_new"),this.db.run(`
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
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(7,new Date().toISOString()),l.debug("DB","Successfully removed UNIQUE constraint from session_summaries.memory_session_id")}addObservationHierarchicalFields(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(8))return;if(this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="title")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString());return}l.debug("DB","Adding hierarchical fields to observations table"),this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(8,new Date().toISOString()),l.debug("DB","Successfully added hierarchical fields to observations table")}makeObservationsTextNullable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(9))return;let s=this.db.query("PRAGMA table_info(observations)").all().find(n=>n.name==="text");if(!s||s.notnull===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString());return}l.debug("DB","Making observations.text nullable"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TABLE IF EXISTS observations_new"),this.db.run(`
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
    `),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(9,new Date().toISOString()),l.debug("DB","Successfully made observations.text nullable")}createUserPromptsTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(10))return;if(this.db.query("PRAGMA table_info(user_prompts)").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString());return}l.debug("DB","Creating user_prompts table with FTS5 support"),this.db.run("BEGIN TRANSACTION"),this.db.run(`
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
    `);let s=`
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
    `;try{this.db.run(s),this.db.run(n)}catch(o){o instanceof Error?l.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},o):l.warn("DB","FTS5 not available \u2014 user_prompts_fts skipped (search uses ChromaDB)",{},new Error(String(o))),this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),l.debug("DB","Created user_prompts table (without FTS5)");return}this.db.run("COMMIT"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(10,new Date().toISOString()),l.debug("DB","Successfully created user_prompts table")}ensureDiscoveryTokensColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(11))return;this.db.query("PRAGMA table_info(observations)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),l.debug("DB","Added discovery_tokens column to observations table")),this.db.query("PRAGMA table_info(session_summaries)").all().some(i=>i.name==="discovery_tokens")||(this.db.run("ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0"),l.debug("DB","Added discovery_tokens column to session_summaries table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(11,new Date().toISOString())}createPendingMessagesTable(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(16))return;if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length>0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString());return}l.debug("DB","Creating pending_messages table"),this.db.run(`
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
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),l.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;l.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(u=>u.name===o);return a.some(u=>u.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),l.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(l.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?l.debug("DB",`Successfully renamed ${t} session ID columns`):l.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),l.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21))return;l.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new");let t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(S=>S.name==="metadata"),n=t.some(S=>S.name==="content_hash"),o=s?`,
        metadata TEXT`:"",i=s?", metadata":"",a=n?`,
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
    `,u=`
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
    `,N=`
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
    `;try{this.recreateObservationsWithCascade(c,u,_,m),this.recreateSessionSummariesWithCascade(g,f,N,O),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),l.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(S){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),S instanceof Error?S:new Error(String(S))}}recreateObservationsWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(n)}recreateSessionSummariesWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(n)}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),l.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),l.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}addSessionPlatformSourceColumn(){let t=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source"),n=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(i=>i.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&t&&n||(t||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${E}'`),l.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${E}'
      WHERE platform_source IS NULL OR platform_source = ''
    `),n||this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(24,new Date().toISOString()))}addObservationModelColumns(){let e=this.db.query("PRAGMA table_info(observations)").all(),t=e.some(n=>n.name==="generated_by_model"),s=e.some(n=>n.name==="relevance_count");t&&s||(t||this.db.run("ALTER TABLE observations ADD COLUMN generated_by_model TEXT"),s||this.db.run("ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(26,new Date().toISOString()))}ensureMergedIntoProjectColumns(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE observations ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_merged_into ON observations(merged_into_project)"),this.db.query("PRAGMA table_info(session_summaries)").all().some(s=>s.name==="merged_into_project")||this.db.run("ALTER TABLE session_summaries ADD COLUMN merged_into_project TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_summaries_merged_into ON session_summaries(merged_into_project)")}addObservationSubagentColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(27),t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(i=>i.name==="agent_type"),n=t.some(i=>i.name==="agent_id");s||this.db.run("ALTER TABLE observations ADD COLUMN agent_type TEXT"),n||this.db.run("ALTER TABLE observations ADD COLUMN agent_id TEXT"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_type ON observations(agent_type)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_agent_id ON observations(agent_id)");let o=this.db.query("PRAGMA table_info(pending_messages)").all();if(o.length>0){let i=o.some(d=>d.name==="agent_type"),a=o.some(d=>d.name==="agent_id");i||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_type TEXT"),a||this.db.run("ALTER TABLE pending_messages ADD COLUMN agent_id TEXT")}e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(27,new Date().toISOString())}ensurePendingMessagesToolUseIdColumn(){if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString());return}this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="tool_use_id")||this.db.run("ALTER TABLE pending_messages ADD COLUMN tool_use_id TEXT"),this.db.run("BEGIN TRANSACTION");try{this.db.run(`
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
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(28,new Date().toISOString()),this.db.run("COMMIT")}catch(n){throw this.db.run("ROLLBACK"),n}}addObservationsUniqueContentHashIndex(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(29))return;let t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(o=>o.name==="memory_session_id"),n=t.some(o=>o.name==="content_hash");if(!s||!n){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString());return}this.db.run("BEGIN TRANSACTION");try{this.db.run(`
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
      `),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(29,new Date().toISOString()),this.db.run("COMMIT")}catch(o){throw this.db.run("ROLLBACK"),o}}addObservationsMetadataColumn(){this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="metadata")||(this.db.run("ALTER TABLE observations ADD COLUMN metadata TEXT"),l.debug("DB","Added metadata column to observations table (#2116)")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(30,new Date().toISOString())}updateMemorySessionId(e,t){this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(t,e)}markSessionCompleted(e){let t=Date.now(),s=new Date(t).toISOString();this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(s,t,e)}ensureMemorySessionIdRegistered(e,t,s){let n=this.db.prepare(`
      SELECT id, memory_session_id, worker_port FROM sdk_sessions WHERE id = ?
    `).get(e);if(!n)throw new Error(`Session ${e} not found in sdk_sessions`);n.memory_session_id!==t&&(this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(t,e),l.info("DB","Registered memory_session_id before storage (FK fix)",{sessionDbId:e,oldId:n.memory_session_id,newId:t})),typeof s=="number"&&n.worker_port!==s&&this.db.prepare(`
        UPDATE sdk_sessions SET worker_port = ? WHERE id = ?
      `).run(s,e)}getRecentSummaries(e,t=10){return this.db.prepare(`
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
    `).all(e)}getAllProjects(e){let t=e?D(e):void 0,s=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `,n=[Ae];return t&&(s+=" AND COALESCE(platform_source, ?) = ?",n.push(E,t)),s+=" ORDER BY project ASC",this.db.prepare(s).all(...n).map(i=>i.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${E}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${E}'), project
      ORDER BY latest_epoch DESC
    `).all(Ae),t=[],s=new Set,n={};for(let i of e){let a=D(i.platform_source);n[a]||(n[a]=[]),n[a].includes(i.project)||n[a].push(i.project),s.has(i.project)||(s.add(i.project),t.push(i.project))}let o=ct(Object.keys(n));return{projects:t,sources:o,projectsBySource:Object.fromEntries(o.map(i=>[i,n[i]||[]]))}}getLatestUserPrompt(e,t){let s=this.resolvePromptSessionDbId(e,t),n=s!==null?"up.session_db_id = ?":"up.content_session_id = ?",o=s!==null?s:e;return this.db.prepare(`
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
    `).get(o)}findRecentDuplicateUserPrompt(e,t,s,n){return ut(this.db,e,ie(t),s,this.resolvePromptSessionDbId(e,n)??void 0)}getRecentSessionsWithStatus(e,t=3,s){let n=[e],o="";return s&&(o=`AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`,n.push(D(s))),n.push(t),this.db.prepare(`
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
    `).all(...n)}getObservationsForSession(e,t){let s=[e],n="";return t&&(n=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions s
          WHERE s.memory_session_id = observations.memory_session_id
            AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?
        )
      `,s.push(D(t))),this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ${n}
      ORDER BY created_at_epoch ASC
    `).all(...s)}getObservationById(e,t){return t?this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      WHERE o.id = ?
        AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?
    `).get(e,D(t))||null:this.db.prepare(`
        SELECT *
        FROM observations
        WHERE id = ?
      `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,platformSource:i,type:a,concepts:d,files:c}=t,u=s==="relevance",_=u?"":`ORDER BY o.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,m=n&&!u?`LIMIT ${n}`:"",g=e.map(()=>"?").join(","),f=[...e],N=[];if(o&&(N.push("o.project = ?"),f.push(o)),i&&(N.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),f.push(D(i))),a)if(Array.isArray(a)){let R=a.map(()=>"?").join(",");N.push(`o.type IN (${R})`),f.push(...a)}else N.push("o.type = ?"),f.push(a);if(d){let R=Array.isArray(d)?d:[d],h=R.map(()=>"EXISTS (SELECT 1 FROM json_each(o.concepts) WHERE value = ?)");f.push(...R),N.push(`(${h.join(" OR ")})`)}if(c){let R=Array.isArray(c)?c:[c],h=R.map(()=>"(EXISTS (SELECT 1 FROM json_each(o.files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(o.files_modified) WHERE value LIKE ?))");R.forEach(y=>{f.push(`%${y}%`,`%${y}%`)}),N.push(`(${h.join(" OR ")})`)}let O=N.length>0?`WHERE o.id IN (${g}) AND ${N.join(" AND ")}`:`WHERE o.id IN (${g})`,v=this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      ${O}
      ${_}
      ${m}
    `).all(...f);if(!u)return v;let C=new Map(v.map(R=>[R.id,R])),b=e.map(R=>C.get(R)).filter(R=>!!R);return n?b.slice(0,n):b}getSummaryForSession(e,t){let s=[e],n="";return t&&(n=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions sdk
          WHERE sdk.memory_session_id = session_summaries.memory_session_id
            AND COALESCE(NULLIF(sdk.platform_source, ''), '${E}') = ?
        )
      `,s.push(D(t))),this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ${n}
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(...s)||null}getFilesForSession(e){let s=this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `).all(e),n=new Set,o=new Set;for(let i of s)ve(i.files_read).forEach(a=>n.add(a)),ve(i.files_modified).forEach(a=>o.add(a));return{filesRead:Array.from(n),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
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
    `).all(...e)}getPromptNumberFromUserPrompts(e,t){let s=this.resolvePromptSessionDbId(e,t);return s!==null?this.db.prepare(`
        SELECT COUNT(*) as count FROM user_prompts WHERE session_db_id = ?
      `).get(s).count:this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(e).count}createSDKSession(e,t,s,n,o){let i=new Date,a=i.getTime(),d=_r(n,o),c=d.platformSource??E,u=this.rt(ie(s)),_=this.db.prepare(`
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
    `).run(e,t,c,u,d.customTitle||null,i.toISOString(),a);return Number(m.lastInsertRowid)}saveUserPrompt(e,t,s,n){let o=new Date,i=o.getTime(),a=this.rt(ie(s)),d=this.resolvePromptSessionDbId(e,n);return this.db.prepare(`
      INSERT INTO user_prompts
      (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(d,e,t,a,o.toISOString(),i).lastInsertRowid}getUserPrompt(e,t,s){let n=this.resolvePromptSessionDbId(e,s);return n!==null?this.db.prepare(`
        SELECT prompt_text
        FROM user_prompts
        WHERE session_db_id = ? AND prompt_number = ?
        LIMIT 1
      `).get(n,t)?.prompt_text??null:this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,n,o=0,i,a){let d=i??Date.now(),c=new Date(d).toISOString(),u=this.rt(s.title),_=this.rt(s.subtitle),m=this.rt(s.narrative),g=this.rl(s.facts),f=this.rt(s.metadata??null),N=De(e,u??null,m??null),O=Pe({type:s.type,narrative:m,files_modified:s.files_modified}),S;if(this.mq.reconcile.enabled){let R=this.reconcileBeforeInsert(t,s.type,u??null,m??null);if(R.action==="NOOP"&&R.candidateId){let h=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE id = ?").get(R.candidateId);if(h)return{id:h.id,createdAtEpoch:h.created_at_epoch}}else R.action==="UPDATE"&&(S=R.candidateId)}let C=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
       generated_by_model, metadata, importance, valid_from, subject_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_session_id, content_hash) DO NOTHING
      RETURNING id, created_at_epoch
    `).get(e,t,s.type,u,_,JSON.stringify(g),m,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),n||null,o,s.agent_type??null,s.agent_id??null,N,c,d,a||null,f,O,d,we({title:u??null,facts:g,narrative:m??null}));if(C)return S!==void 0&&this.mq.supersession.enabled&&this.supersedeObservation(S,C.id,d),{id:C.id,createdAtEpoch:C.created_at_epoch};let b=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?").get(e,N);if(!b)throw new Error(`storeObservation: ON CONFLICT without existing row for content_hash=${N}`);return{id:b.id,createdAtEpoch:b.created_at_epoch}}storeSummary(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),u=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,this.rt(s.request),this.rt(s.investigated),this.rt(s.learned),this.rt(s.completed),this.rt(s.next_steps),this.rt(s.notes),n||null,o,d,a);return{id:Number(u.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,n,o,i=0,a,d){let c=a??Date.now(),u=new Date(c).toISOString();return this.db.transaction(()=>{let m=[],g=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model, importance, valid_from, subject_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),f=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let O of s){let S=this.rt(O.title),v=this.rt(O.subtitle),C=this.rt(O.narrative),b=this.rl(O.facts),R=De(e,S??null,C??null),h=g.get(e,t,O.type,S,v,JSON.stringify(b),C,JSON.stringify(O.concepts),JSON.stringify(O.files_read),JSON.stringify(O.files_modified),o||null,i,O.agent_type??null,O.agent_id??null,R,u,c,d||null,Pe({type:O.type,narrative:C,files_modified:O.files_modified}),c,we({title:S??null,facts:b,narrative:C??null}));if(h){m.push(h.id);continue}let y=f.get(e,R);if(!y)throw new Error(`storeObservations: ON CONFLICT without existing row for content_hash=${R}`);m.push(y.id)}let N=null;if(n){let S=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,this.rt(n.request),this.rt(n.investigated),this.rt(n.learned),this.rt(n.completed),this.rt(n.next_steps),this.rt(n.notes),o||null,i,u,c);N=Number(S.lastInsertRowid)}return{observationIds:m,summaryId:N,createdAtEpoch:c}})()}markObservationsUsed(e,t="explicit_fetch",s=Date.now()){if(e.length!==0)try{let n=this.db.query("PRAGMA table_info(observations)").all(),o=g=>n.some(f=>f.name===g),i=o("last_used_at"),a=o("relevance_count"),d=rt[t],c=o(d);if(!i&&!a&&!c)return;let u=[],_=[];i&&(u.push("last_used_at = ?"),_.push(s)),a&&u.push("relevance_count = COALESCE(relevance_count, 0) + 1"),c&&u.push(`${d} = COALESCE(${d}, 0) + 1`);let m=e.map(()=>"?").join(",");this.db.prepare(`UPDATE observations SET ${u.join(", ")} WHERE id IN (${m})`).run(..._,...e)}catch(n){l.debug("DB","markObservationsUsed failed",{count:e.length,channel:t},n instanceof Error?n:new Error(String(n)))}}evaporateScratch(e){try{let t=this.db.prepare("DELETE FROM observations WHERE memory_session_id = ? AND type = 'scratch'").run(e),s=Number(t.changes??0);return s>0&&l.info("DB","Evaporated scratch observations at SessionEnd",{memorySessionId:e,count:s}),s}catch(t){return l.warn("DB","evaporateScratch failed",{memorySessionId:e},t instanceof Error?t:new Error(String(t))),0}}evaporateAllScratch(){try{let e=this.db.prepare("DELETE FROM observations WHERE type = 'scratch'").run(),t=Number(e.changes??0);return t>0&&l.info("DB","Evaporated all scratch observations on idle shutdown",{count:t}),t}catch(e){return l.warn("DB","evaporateAllScratch failed",{},e instanceof Error?e:new Error(String(e))),0}}reconcileBeforeInsert(e,t,s,n){try{let o=Date.now()-7776e6,i=this.db.query("PRAGMA table_info(observations)").all().some(_=>_.name==="valid_to"),a=i?"AND valid_to IS NULL":"",d=this.db.prepare(`
        SELECT id, title, narrative, importance
        FROM observations
        WHERE project = ? AND type = ? AND created_at_epoch >= ? ${a}
        ORDER BY created_at_epoch DESC
        LIMIT 20
      `).all(e,t,o);if(d.length===0)return{action:"ADD"};let c=this.mq.supersession.enabled&&i;return at({title:s,narrative:n},d,{noopThreshold:this.mq.reconcile.noopThreshold,updateBand:this.mq.reconcile.updateBand,supersessionEnabled:c})}catch(o){return l.warn("DB","reconcileBeforeInsert failed; defaulting to ADD",{project:e,type:t},o instanceof Error?o:new Error(String(o))),{action:"ADD"}}}supersedeObservation(e,t,s){try{this.db.prepare(`
        UPDATE observations
           SET valid_to = ?,
               metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?)
         WHERE id = ? AND valid_to IS NULL
      `).run(s,t,e)}catch(n){l.warn("DB","supersedeObservation failed",{oldId:e,newId:t},n instanceof Error?n:new Error(String(n)))}}getObservationsAsOf(e,t){return this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="valid_from")?this.db.prepare(`
      SELECT * FROM observations
      WHERE project = ?
        AND COALESCE(valid_from, created_at_epoch) <= ?
        AND (valid_to IS NULL OR valid_to > ?)
    `).all(e,t,t):this.db.prepare("SELECT * FROM observations WHERE project = ?").all(e)}deleteObservationsByProject(e,t={}){let s=(e??"").trim();if(s===""||s==="*")throw new Error(`deleteObservationsByProject: refusing unsafe project '${e}'`);let n=this.db.prepare("SELECT count(*) AS c FROM observations WHERE project = ?").get(s).c,o=this.db.prepare("SELECT count(*) AS c FROM session_summaries WHERE project = ?").get(s).c;if(t.dryRun)return{project:s,dryRun:!0,observationsDeleted:n,summariesDeleted:o};this.db.transaction(()=>{this.db.prepare("DELETE FROM observations WHERE project = ?").run(s),this.db.prepare("DELETE FROM session_summaries WHERE project = ?").run(s)})();try{this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}catch(a){l.warn("DB","observations_fts rebuild after project delete failed",{project:s},a instanceof Error?a:new Error(String(a)))}return l.info("DB","Deleted observations by project",{project:s,observationsDeleted:n,summariesDeleted:o}),{project:s,dryRun:!1,observationsDeleted:n,summariesDeleted:o}}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,platformSource:i}=t,a=s==="relevance",d=a?"":`ORDER BY ss.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,c=n&&!a?`LIMIT ${n}`:"",u=e.map(()=>"?").join(","),_=[...e],m=[];o&&(m.push("ss.project = ?"),_.push(o)),i&&(m.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),_.push(D(i)));let g=m.length>0?`AND ${m.join(" AND ")}`:"",N=this.db.prepare(`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON s.memory_session_id = ss.memory_session_id
      WHERE ss.id IN (${u}) ${g}
      ${d}
      ${c}
    `).all(..._);if(!a)return N;let O=new Map(N.map(v=>[v.id,v])),S=e.map(v=>O.get(v)).filter(v=>!!v);return n?S.slice(0,n):S}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,platformSource:i}=t,a=s==="relevance",d=a?"":`ORDER BY up.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,c=n?`LIMIT ${n}`:"",u=e.map(()=>"?").join(","),_=[...e],m=[];o&&(m.push("s.project = ?"),_.push(o)),i&&(m.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),_.push(D(i)));let g=m.length>0?`AND ${m.join(" AND ")}`:"",N=this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.id IN (${u}) ${g}
      ${d}
      ${c}
    `).all(..._);if(!a)return N;let O=new Map(N.map(S=>[S.id,S]));return e.map(S=>O.get(S)).filter(S=>!!S)}getTimelineAroundTimestamp(e,t=10,s=10,n,o){return this.getTimelineAroundObservation(null,e,t,s,n,o)}getTimelineAroundObservation(e,t,s=10,n=10,o,i){let a=i?D(i):void 0,d=(b,R)=>{let h=[],y=[];return o&&(h.push(`${b}.project = ?`),y.push(o)),a&&(h.push(`COALESCE(NULLIF(${R}.platform_source, ''), '${E}') = ?`),y.push(a)),{clause:h.length>0?`AND ${h.join(" AND ")}`:"",params:y}},c=d("o","src"),u=d("ss","src"),_=d("s","s"),m,g;if(e!==null){let b=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id <= ? ${c.clause}
        ORDER BY o.id DESC
        LIMIT ?
      `,R=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id >= ? ${c.clause}
        ORDER BY o.id ASC
        LIMIT ?
      `;try{let h=this.db.prepare(b).all(e,...c.params,s+1),y=this.db.prepare(R).all(e,...c.params,n+1);if(h.length===0&&y.length===0)return{observations:[],sessions:[],prompts:[]};m=h.length>0?h[h.length-1].created_at_epoch:t,g=y.length>0?y[y.length-1].created_at_epoch:t}catch(h){return h instanceof Error?l.error("DB","Error getting boundary observations",{project:o},h):l.error("DB","Error getting boundary observations with non-Error",{},new Error(String(h))),{observations:[],sessions:[],prompts:[]}}}else{let b=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch <= ? ${c.clause}
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `,R=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch >= ? ${c.clause}
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `;try{let h=this.db.prepare(b).all(t,...c.params,s),y=this.db.prepare(R).all(t,...c.params,n+1);if(h.length===0&&y.length===0)return{observations:[],sessions:[],prompts:[]};m=h.length>0?h[h.length-1].created_at_epoch:t,g=y.length>0?y[y.length-1].created_at_epoch:t}catch(h){return h instanceof Error?l.error("DB","Error getting boundary timestamps",{project:o},h):l.error("DB","Error getting boundary timestamps with non-Error",{},new Error(String(h))),{observations:[],sessions:[],prompts:[]}}}let f=`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
      WHERE o.created_at_epoch >= ? AND o.created_at_epoch <= ? ${c.clause}
      ORDER BY o.created_at_epoch ASC
    `,N=`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions src ON src.memory_session_id = ss.memory_session_id
      WHERE ss.created_at_epoch >= ? AND ss.created_at_epoch <= ? ${u.clause}
      ORDER BY ss.created_at_epoch ASC
    `,O=`
      SELECT up.*, s.project, s.memory_session_id, COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${_.clause}
      ORDER BY up.created_at_epoch ASC
    `,S=this.db.prepare(f).all(m,g,...c.params),v=this.db.prepare(N).all(m,g,...u.params),C=this.db.prepare(O).all(m,g,..._.params);return{observations:S,sessions:v.map(b=>({id:b.id,memory_session_id:b.memory_session_id,project:b.project,request:b.request,completed:b.completed,next_steps:b.next_steps,created_at:b.created_at,created_at_epoch:b.created_at_epoch})),prompts:C.map(b=>({id:b.id,content_session_id:b.content_session_id,prompt_number:b.prompt_number,prompt_text:b.prompt_text,project:b.project,platform_source:b.platform_source,created_at:b.created_at,created_at_epoch:b.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
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
    `).all(...e)}getOrCreateManualSession(e){let t=`manual-${e}`,s=`manual-content-${e}`;if(this.db.prepare("SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?").get(t))return t;let o=new Date;return this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(t,s,e,E,o.toISOString(),o.getTime()),l.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}close(){this.db.close()}importSdkSession(e){let t=D(e.platform_source),s=this.db.prepare(`SELECT id FROM sdk_sessions
       WHERE platform_source = ? AND content_session_id = ?`).get(t,e.content_session_id);return s?{imported:!1,id:s.id}:{imported:!0,id:this.db.prepare(`
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
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.agent_type??null,e.agent_id??null,e.created_at,e.created_at_epoch).lastInsertRowid}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let t=null,s=e.platform_source?D(e.platform_source):void 0;if(typeof e.session_db_id=="number"){let a=this.db.prepare(`
        SELECT id, content_session_id, COALESCE(NULLIF(platform_source, ''), '${E}') as platform_source
        FROM sdk_sessions
        WHERE id = ?
        LIMIT 1
      `).get(e.session_db_id);a&&a.content_session_id===e.content_session_id&&(!s||D(a.platform_source)===s)&&(t=a.id)}t===null&&(t=this.resolvePromptSessionDbId(e.content_session_id,void 0,s));let n=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE ${t!==null?"session_db_id = ?":"content_session_id = ?"} AND prompt_number = ?
    `).get(t??e.content_session_id,e.prompt_number);return n?{imported:!1,id:n.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        session_db_id, content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(t,e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}};var Tt=require("os"),ft=B(require("path"),1),bt=require("child_process");var ce=require("fs"),de=B(require("path"),1);var K={isWorktree:!1,worktreeName:null,parentRepoPath:null,parentProjectName:null};function gt(r){let e=de.default.join(r,".git"),t;try{t=(0,ce.statSync)(e)}catch(u){return u instanceof Error&&u.code!=="ENOENT"&&l.warn("GIT","Unexpected error checking .git",{error:u instanceof Error?u.message:String(u)}),K}if(!t.isFile())return K;let s;try{s=(0,ce.readFileSync)(e,"utf-8").trim()}catch(u){return l.warn("GIT","Failed to read .git file",{error:u instanceof Error?u.message:String(u)}),K}let n=s.match(/^gitdir:\s*(.+)$/);if(!n)return K;let i=n[1].match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)$/);if(!i)return K;let a=i[1],d=de.default.basename(r),c=de.default.basename(a);return{isWorktree:!0,worktreeName:d,parentRepoPath:a,parentProjectName:c}}function St(r){return r==="~"||r.startsWith("~/")?r.replace(/^~/,(0,Tt.homedir)()):r}function mr(r){try{return(0,bt.execFileSync)("git",["rev-parse","--show-toplevel"],{cwd:r,encoding:"utf-8",stdio:["ignore","pipe","ignore"],windowsHide:!0}).trim()||null}catch{return null}}function Er(r){if(!r||r.trim()==="")return l.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=St(r),s=mr(e)??e,n=ft.default.basename(s);if(n===""){if(process.platform==="win32"){let i=r.match(/^([A-Z]):\\/i);if(i){let d=`drive-${i[1].toUpperCase()}`;return l.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:d}),d}}return l.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}return n}function ht(r){let e=Er(r);if(!r)return{primary:e,parent:null,isWorktree:!1,allProjects:[e]};let t=St(r),s=gt(t);if(s.isWorktree&&s.parentProjectName){let n=`${s.parentProjectName}/${e}`;return{primary:n,parent:s.parentProjectName,isWorktree:!0,allProjects:[s.parentProjectName,n]}}return{primary:e,parent:null,isWorktree:!1,allProjects:[e]}}var k=require("fs"),V=require("path"),Fe=require("os");var Ue={DEFAULT:3e5,HEALTH_CHECK:3e3,API_REQUEST:3e4,HOOK_READINESS_WAIT:1e4,POST_SPAWN_WAIT:15e3,READINESS_WAIT:3e4,PORT_IN_USE_WAIT:3e3,WORKER_STARTUP_WAIT:1e3,PRE_RESTART_SETTLE_DELAY:2e3,POWERSHELL_COMMAND:1e4,WINDOWS_MULTIPLIER:1.5};function Rt(r){return process.platform==="win32"?Math.round(r*Ue.WINDOWS_MULTIPLIER):r}var I=require("fs");var w=require("path");var It=require("crypto");var gr=process.platform==="win32";function Tr(r){(0,I.existsSync)(r)||(0,I.mkdirSync)(r,{recursive:!0})}function W(r,e){let t=r;try{if((0,I.lstatSync)(r).isSymbolicLink())try{t=(0,I.realpathSync)(r)}catch{let c=(0,I.readlinkSync)(r);t=(0,w.resolve)((0,w.dirname)(r),c)}}catch(c){let u=c.code;if(u!=="ENOENT"&&u!=="ENOTDIR")throw c}Tr((0,w.dirname)(t));let s=(0,w.dirname)(t),n=(0,w.basename)(t),o=(0,w.join)(s,`.${n}.${process.pid}.${(0,It.randomBytes)(6).toString("hex")}.tmp`),i=Buffer.from(JSON.stringify(e,null,2)+`
`,"utf-8"),a;try{a=(0,I.statSync)(t).mode&511}catch{}let d;try{d=a!==void 0?(0,I.openSync)(o,"w",a):(0,I.openSync)(o,"w");let c=0;for(;c<i.length;){let u=(0,I.writeSync)(d,i,c,i.length-c);if(u===0)throw new Error(`writeSync stalled at ${c}/${i.length} bytes`);c+=u}if((0,I.fsyncSync)(d),(0,I.closeSync)(d),d=void 0,(0,I.renameSync)(o,t),!gr){let u;try{u=(0,I.openSync)(s,"r"),(0,I.fsyncSync)(u)}catch{}finally{if(u!==void 0)try{(0,I.closeSync)(u)}catch{}}}}catch(c){if(d!==void 0)try{(0,I.closeSync)(d)}catch{}try{(0,I.unlinkSync)(o)}catch{}throw c}}var ue=class{static DEFAULTS={KEEPMIND_MODEL:"claude-haiku-4-5-20251001",KEEPMIND_CONTEXT_OBSERVATIONS:"50",KEEPMIND_WORKER_PORT:String(37700+(process.getuid?.()??77)%100),KEEPMIND_WORKER_HOST:"127.0.0.1",KEEPMIND_API_TIMEOUT_MS:String(Rt(Ue.API_REQUEST)),KEEPMIND_SKIP_TOOLS:["ListMcpResourcesTool","SlashCommand","Skill","TodoWrite","AskUserQuestion","ToolSearch","BashOutput","KillShell","EnterPlanMode","ExitPlanMode","TaskCreate","TaskUpdate","TaskList","TaskGet","TaskOutput","TaskStop","Glob","Grep"].join(","),KEEPMIND_PROVIDER:"claude",KEEPMIND_CLAUDE_AUTH_METHOD:"subscription",KEEPMIND_GEMINI_API_KEY:"",KEEPMIND_GEMINI_MODEL:"gemini-2.5-flash-lite",KEEPMIND_GEMINI_RATE_LIMITING_ENABLED:"true",KEEPMIND_GEMINI_MAX_CONTEXT_MESSAGES:"20",KEEPMIND_GEMINI_MAX_TOKENS:"100000",KEEPMIND_OPENROUTER_API_KEY:"",KEEPMIND_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",KEEPMIND_OPENROUTER_BASE_URL:"",KEEPMIND_OPENROUTER_SITE_URL:"",KEEPMIND_OPENROUTER_APP_NAME:"keepmind",KEEPMIND_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",KEEPMIND_OPENROUTER_MAX_TOKENS:"100000",KEEPMIND_DATA_DIR:(0,V.join)((0,Fe.homedir)(),".keepmind"),KEEPMIND_LOG_LEVEL:"INFO",CLAUDE_CODE_PATH:"",KEEPMIND_MODE:"code",KEEPMIND_CONTEXT_SHOW_READ_TOKENS:"false",KEEPMIND_CONTEXT_SHOW_WORK_TOKENS:"false",KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT:"true",KEEPMIND_CONTEXT_FULL_COUNT:"0",KEEPMIND_CONTEXT_FULL_FIELD:"narrative",KEEPMIND_CONTEXT_SESSION_COUNT:"5",KEEPMIND_OBSERVATION_BATCH_MAX:"8",KEEPMIND_OBSERVATION_COALESCE_MS:"2500",KEEPMIND_MAX_CONTEXT_MESSAGES:"40",KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY:"true",KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE:"false",KEEPMIND_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",KEEPMIND_WELCOME_HINT_ENABLED:"true",KEEPMIND_UPDATE_CHECK_ENABLED:"true",KEEPMIND_FOLDER_CLAUDEMD_ENABLED:"false",KEEPMIND_FOLDER_USE_LOCAL_MD:"false",KEEPMIND_TRANSCRIPTS_ENABLED:"true",KEEPMIND_TRANSCRIPTS_CONFIG_PATH:(0,V.join)((0,Fe.homedir)(),".keepmind","transcript-watch.json"),KEEPMIND_CODEX_TRANSCRIPT_INGESTION:"false",KEEPMIND_MAX_CONCURRENT_AGENTS:"2",KEEPMIND_HOOK_FAIL_LOUD_THRESHOLD:"3",KEEPMIND_EXCLUDED_PROJECTS:"",KEEPMIND_FOLDER_MD_EXCLUDE:"[]",KEEPMIND_FOLDER_MD_SKELETON_DENYLIST:"[]",KEEPMIND_SEMANTIC_INJECT:"false",KEEPMIND_SEMANTIC_INJECT_LIMIT:"5",KEEPMIND_TIER_ROUTING_ENABLED:"false",KEEPMIND_TIER_SIMPLE_MODEL:"haiku",KEEPMIND_TIER_SUMMARY_MODEL:"",KEEPMIND_TIER_FAST_MODEL:"haiku",KEEPMIND_TIER_SMART_MODEL:"sonnet",KEEPMIND_CHROMA_ENABLED:"true",KEEPMIND_TELEGRAM_ENABLED:"true",KEEPMIND_TELEGRAM_BOT_TOKEN:"",KEEPMIND_TELEGRAM_CHAT_ID:"",KEEPMIND_TELEGRAM_TRIGGER_TYPES:"security_alert",KEEPMIND_TELEGRAM_TRIGGER_CONCEPTS:"",KEEPMIND_QUEUE_ENGINE:"sqlite",KEEPMIND_REDIS_URL:"",KEEPMIND_REDIS_HOST:"127.0.0.1",KEEPMIND_REDIS_PORT:"6379",KEEPMIND_REDIS_MODE:"external",KEEPMIND_QUEUE_REDIS_PREFIX:`keepmind_${L("KEEPMIND_WORKER_PORT")??String(37700+(process.getuid?.()??77)%100)}`,KEEPMIND_AUTH_MODE:"api-key",KEEPMIND_RUNTIME:"worker",KEEPMIND_SERVER_URL:`http://127.0.0.1:${L("KEEPMIND_SERVER_PORT")??String(37877+(process.getuid?.()??77)%100)}`,KEEPMIND_SERVER_API_KEY:"",KEEPMIND_SERVER_PROJECT_ID:"",KEEPMIND_SERVER_BETA_URL:`http://127.0.0.1:${L("KEEPMIND_SERVER_PORT")??String(37877+(process.getuid?.()??77)%100)}`,KEEPMIND_SERVER_BETA_API_KEY:"",KEEPMIND_SERVER_BETA_PROJECT_ID:""};static getAllDefaults(){return{...this.DEFAULTS}}static envOverride(e){return L(e)}static get(e){return this.envOverride(e)??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS)){let n=this.envOverride(s);n!==void 0&&(t[s]=n)}return t}static toCanonicalKeys(e){let t={};for(let[s,n]of Object.entries(e)){if(!s.startsWith("CLAUDE_MEM_")){t[s]=n;continue}let o="KEEPMIND_"+s.slice(11);e[o]===void 0&&(t[o]=n)}return t}static loadFromFile(e,t=!0){try{if(!(0,k.existsSync)(e)){let a=this.getAllDefaults();try{let d=(0,V.dirname)(e);(0,k.existsSync)(d)||(0,k.mkdirSync)(d,{recursive:!0}),W(e,a),console.warn("[SETTINGS] Created settings file with defaults:",e)}catch(d){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,d instanceof Error?d.message:String(d))}return t?this.applyEnvOverrides(a):a}let s=(0,k.readFileSync)(e,"utf-8"),n=JSON.parse(s.replace(/^\uFEFF/,"")),o=n;if(n.env&&typeof n.env=="object"){o=n.env;try{W(e,o),console.warn("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(a){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,a instanceof Error?a.message:String(a))}}let i={...this.DEFAULTS};for(let a of Object.keys(this.DEFAULTS)){let d=ee(a,o);d!==void 0&&(i[a]=d)}if(ze(o))try{W(e,this.toCanonicalKeys(o)),console.warn("[SETTINGS] Migrated settings file to the KEEPMIND_* key prefix:",e)}catch(a){console.warn("[SETTINGS] Failed to migrate settings keys (legacy names still honored):",e,a instanceof Error?a.message:String(a))}return t?this.applyEnvOverrides(i):i}catch(s){console.warn("[SETTINGS] Failed to load settings, using defaults:",e,s instanceof Error?s.message:String(s));let n=this.getAllDefaults();try{if((0,k.existsSync)(e)){let o=`${e}.corrupt-${Date.now()}`;(0,k.renameSync)(e,o),console.warn("[SETTINGS] Backed up corrupt settings file to:",o)}W(e,n),console.warn("[SETTINGS] Recovered settings file with defaults:",e)}catch(o){console.warn("[SETTINGS] Failed to recover corrupt settings file:",e,o instanceof Error?o.message:String(o))}return t?this.applyEnvOverrides(n):n}}};var Y=require("fs"),le=require("path");var x=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=st(),t=L("KEEPMIND_MODES_DIR"),s=[...t?[t]:[],(0,le.join)(e,"modes"),(0,le.join)(e,"..","plugin","modes")],n=s.find(o=>(0,Y.existsSync)(o));this.modesDir=n||s[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let n in t){let o=t[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?s[n]=this.deepMerge(i,o):s[n]=o}return s}loadModeFile(e){let t=(0,le.join)(this.modesDir,`${e}.json`);if(!(0,Y.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,Y.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,l.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(c=>c.id),concepts:d.observation_concepts.map(c=>c.id)}),d}catch(d){if(d instanceof Error?l.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{message:d.message}):l.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{error:String(d)}),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:n}=t,o;try{o=this.loadMode(s)}catch(d){d instanceof Error?l.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{message:d.message}):l.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{error:String(d)}),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),l.debug("SYSTEM",`Loaded override file: ${n} for parent ${s}`)}catch(d){return d instanceof Error?l.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{message:d.message}):l.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{error:String(d)}),this.activeMode=o,o}if(!i)return l.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${s}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,l.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${n})`,void 0,{parent:s,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}};function Nt(){let r=$.settings(),e=ue.loadFromFile(r),t=x.getInstance().getActiveMode(),s=new Set(t.observation_types.map(o=>o.id)),n=new Set(t.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.KEEPMIND_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.KEEPMIND_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.KEEPMIND_CONTEXT_SESSION_COUNT,10),showReadTokens:e.KEEPMIND_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.KEEPMIND_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:s,observationConcepts:n,fullObservationField:e.KEEPMIND_CONTEXT_FULL_FIELD,showLastSummary:e.KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var p={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},pe=4,$e=1;function Ge(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/pe)}function Be(r){let e=r.length,t=r.reduce((i,a)=>i+Ge(a),0),s=r.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=s-t,o=s>0?Math.round(n/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:n,savingsPercent:o}}function fr(r){return x.getInstance().getWorkEmoji(r)}function q(r,e){let t=Ge(r),s=r.discovery_tokens||0,n=fr(r.type),o=s>0?`${n} ${s.toLocaleString("en-US")}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:o,workEmoji:n}}function _e(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}function br(r){return hr(r)}var Sr=28;function hr(r){let e=(r.title?.length??8)+Sr;return Math.max(1,Math.ceil(e/pe))}function Rr(r,e){if(!Number.isFinite(e)||e<=0)return r;let t=[],s=0;for(let n of r){let o=br(n);s+o>e||(t.push(n),s+=o)}return t}function Ot(r,e){let t=e.now??Date.now(),s=r.map(i=>({o:i,score:ot(i,{now:t,halfLifeDays:e.halfLifeDays})})).sort((i,a)=>a.score-i.score).map(i=>i.o),n=e.maxRows>0?s.slice(0,e.maxRows):s;return Rr(n,e.tokenBudget).sort((i,a)=>(a.created_at_epoch??0)-(i.created_at_epoch??0))}var At=B(require("path"),1),me=require("fs");function yt(r,e,t,s){let n=Array.from(t.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(t.observationConcepts),a=i.map(()=>"?").join(",");return r.db.prepare(`
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
  `).all(e,e,s??null,s??null,...n,...i,t.totalObservationCount)}function Dt(r,e,t,s){return r.db.prepare(`
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
  `).all(e,e,s??null,s??null,t.sessionCount+$e)}function vt(r,e,t,s){let n=Array.from(t.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(t.observationConcepts),a=i.map(()=>"?").join(","),d=e.map(()=>"?").join(",");return r.db.prepare(`
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
  `).all(...e,...e,s??null,s??null,...n,...i,t.totalObservationCount)}function Ct(r,e,t,s){let n=e.map(()=>"?").join(",");return r.db.prepare(`
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
  `).all(...e,...e,s??null,s??null,t.sessionCount+$e)}function Ir(r){return r.replace(/[/.]/g,"-")}function Nr(r){if(!r.includes('"type":"assistant"'))return null;let e=JSON.parse(r);if(e.type==="assistant"&&e.message?.content&&Array.isArray(e.message.content)){let t="";for(let s of e.message.content)s.type==="text"&&(t+=s.text);if(t=t.replace(mt,"").trim(),t)return t}return null}function Or(r){for(let e=r.length-1;e>=0;e--)try{let t=Nr(r[e]);if(t)return t}catch(t){t instanceof Error?l.debug("WORKER","Skipping malformed transcript line",{lineIndex:e},t):l.debug("WORKER","Skipping malformed transcript line",{lineIndex:e,error:String(t)});continue}return""}function Ar(r){try{if(!(0,me.existsSync)(r))return{assistantMessage:""};let e=(0,me.readFileSync)(r,"utf-8").trim();if(!e)return{assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim());return{assistantMessage:Or(t)}}catch(e){return e instanceof Error?l.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e):l.warn("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r,error:String(e)}),{assistantMessage:""}}}function Lt(r,e,t,s){if(!e.showLastMessage||r.length===0)return{assistantMessage:""};let n=r.find(d=>d.memory_session_id!==t);if(!n)return{assistantMessage:""};let o=n.memory_session_id,i=Ir(s),a=At.default.join(G,"projects",i,`${o}.jsonl`);return Ar(a)}function Mt(r,e){let t=e[0]?.id;return r.map((s,n)=>{let o=n===0?null:e[n+1];return{...s,displayEpoch:o?o.created_at_epoch:s.created_at_epoch,displayTime:o?o.created_at:s.created_at,shouldShowLink:s.id!==t}})}function xt(r,e){let t=[...r.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,n)=>{let o=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),t}function Pt(r,e){return new Set(r.slice(0,e).map(t=>t.id))}function kt(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function Ut(r){return[`# [${r}] recent context, ${kt()}`,""]}function Ft(){return[`Legend: \u{1F3AF}session ${x.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function $t(r,e){let t=[],s=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString("en-US")}t indexed)`,`${r.totalDiscoveryTokens.toLocaleString("en-US")}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?s.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&s.push(`${r.savings.toLocaleString("en-US")}t saved`)),t.push(`Stats: ${s.join(" | ")}`),t.push(""),t}function yr(r,e=new Date){let t=new Date(r);if(Number.isNaN(t.getTime()))return null;let s=i=>Date.UTC(i.getFullYear(),i.getMonth(),i.getDate()),n=Math.round((s(e)-s(t))/864e5);return n<=0?"today":n===1?"yesterday":n<7?`${n} days ago`:n<14?"last week":n<60?`${n} days ago`:`~${Math.round(n/30)} months ago`}function Gt(r){let e=yr(r);return[e?`### ${r} (${e})`:`### ${r}`]}function Bt(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function Ht(r,e,t){let s=r.title||"Untitled",n=x.getInstance().getTypeIcon(r.type),o=e?Bt(e):'"';return`${r.id} ${o} ${n} ${s}`}function jt(r,e,t,s){let n=[],o=r.title||"Untitled",i=x.getInstance().getTypeIcon(r.type),a=e?Bt(e):'"',{readTokens:d,discoveryDisplay:c}=q(r,s);n.push(`**${r.id}** ${a} ${i} **${o}**`),t&&n.push(t);let u=[];return s.showReadTokens&&u.push(`~${d}t`),s.showWorkTokens&&u.push(c),u.length>0&&n.push(u.join(" ")),n.push(""),n}function Xt(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}var wt=200;function J(r,e){if(!e)return[];let t=e.length>wt?`${e.slice(0,wt).trimEnd()}\u2026`:e;return[`**${r}**: ${t}`,""]}function Kt(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function Wt(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function Vt(r){return`# [${r}] recent context, ${kt()}

No previous sessions found.`}function Yt(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function qt(r){return["",`${p.bright}${p.cyan}[${r}] recent context, ${Yt()}${p.reset}`,`${p.gray}${"\u2500".repeat(60)}${p.reset}`,""]}function Jt(){let e=x.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${p.dim}Legend: session-request | ${e}${p.reset}`,""]}function Qt(){return[`${p.bright}Column Key${p.reset}`,`${p.dim}  Read: Tokens to read this observation (cost to learn it now)${p.reset}`,`${p.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${p.reset}`,""]}function zt(){return[`${p.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${p.reset}`,"",`${p.dim}When you need implementation details, rationale, or debugging context:${p.reset}`,`${p.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${p.reset}`,`${p.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${p.reset}`,`${p.dim}  - Trust this index over re-reading code for past decisions and learnings${p.reset}`,""]}function Zt(r,e){let t=[];if(t.push(`${p.bright}${p.cyan}Context Economics${p.reset}`),t.push(`${p.dim}  Loading: ${r.totalObservations} observations (${r.totalReadTokens.toLocaleString()} tokens to read)${p.reset}`),t.push(`${p.dim}  Work investment: ${r.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${p.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${r.savings.toLocaleString()} tokens (${r.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${r.savings.toLocaleString()} tokens`:s+=`${r.savingsPercent}% reduction from reuse`,t.push(`${p.green}${s}${p.reset}`)}return t.push(""),t}function es(r){return[`${p.bright}${p.cyan}${r}${p.reset}`,""]}function ts(r){return[`${p.dim}${r}${p.reset}`]}function ss(r,e,t,s){let n=r.title||"Untitled",o=x.getInstance().getTypeIcon(r.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=q(r,s),c=t?`${p.dim}${e}${p.reset}`:" ".repeat(e.length),u=s.showReadTokens&&i>0?`${p.dim}(~${i}t)${p.reset}`:"",_=s.showWorkTokens&&a>0?`${p.dim}(${d} ${a.toLocaleString()}t)${p.reset}`:"";return`  ${p.dim}#${r.id}${p.reset}  ${c}  ${o}  ${n} ${u} ${_}`}function rs(r,e,t,s,n){let o=[],i=r.title||"Untitled",a=x.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:c,workEmoji:u}=q(r,n),_=t?`${p.dim}${e}${p.reset}`:" ".repeat(e.length),m=n.showReadTokens&&d>0?`${p.dim}(~${d}t)${p.reset}`:"",g=n.showWorkTokens&&c>0?`${p.dim}(${u} ${c.toLocaleString()}t)${p.reset}`:"";return o.push(`  ${p.dim}#${r.id}${p.reset}  ${_}  ${a}  ${p.bright}${i}${p.reset}`),s&&o.push(`    ${p.dim}${s}${p.reset}`),(m||g)&&o.push(`    ${m} ${g}`),o.push(""),o}function ns(r,e){let t=`${r.request||"Session started"} (${e})`;return[`${p.yellow}#S${r.id}${p.reset} ${t}`,""]}function Q(r,e,t){return e?[`${t}${r}:${p.reset} ${e}`,""]:[]}function os(r){return r.assistantMessage?["","---","",`${p.bright}${p.magenta}Previously${p.reset}`,"",`${p.dim}A: ${r.assistantMessage}${p.reset}`,""]:[]}function is(r,e){let t=Math.round(r/1e3);return["",`${p.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use get_observations([IDs]) or the mem-search skill.${p.reset}`]}function as(r){return`
${p.bright}${p.cyan}[${r}] recent context, ${Yt()}${p.reset}
${p.gray}${"\u2500".repeat(60)}${p.reset}

${p.dim}No previous sessions found for this project yet.${p.reset}
`}function ds(r,e,t,s){let n=[];return s?n.push(...qt(r)):n.push(...Ut(r)),s?n.push(...Jt()):n.push(...Ft()),s&&(n.push(...Qt()),n.push(...zt())),_e(t)&&(s?n.push(...Zt(e,t)):n.push(...$t(e,t))),n}var Te=B(require("path"),1);function fe(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return l.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e instanceof Error?e:new Error(String(e))),[]}}function He(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function je(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function us(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function cs(r,e){return Te.default.isAbsolute(r)?Te.default.relative(e,r).split(Te.default.sep).join("/"):r}function ls(r,e,t){let s=fe(r);if(s.length>0)return cs(s[0],e);if(t){let n=fe(t);if(n.length>0)return cs(n[0],e)}return"General"}function Dr(r){let e=new Map;for(let s of r){let n=s.type==="observation"?s.data.created_at:s.data.displayTime,o=us(n);e.has(o)||e.set(o,[]),e.get(o).push(s)}let t=Array.from(e.entries()).sort((s,n)=>{let o=new Date(s[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(t)}function ps(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?fe(r.facts).join(`
`):null}function vr(r,e,t,s){let n=[];n.push(...Gt(r));let o="";for(let i of e)if(i.type==="summary"){let a=i.data,d=He(a.displayTime);n.push(...Xt(a,d))}else{let a=i.data,d=je(a.created_at),u=d!==o?d:"";if(o=d,t.has(a.id)){let m=ps(a,s);n.push(...jt(a,u,m,s))}else n.push(Ht(a,u,s))}return n}function Cr(r,e,t,s,n){let o=[];o.push(...es(r));let i=null,a="";for(let d of e)if(d.type==="summary"){i=null,a="";let c=d.data,u=He(c.displayTime);o.push(...ns(c,u))}else{let c=d.data,u=ls(c.files_modified,n,c.files_read),_=je(c.created_at),m=_!==a;a=_;let g=t.has(c.id);if(u!==i&&(o.push(...ts(u)),i=u),g){let f=ps(c,s);o.push(...rs(c,_,m,f,s))}else o.push(ss(c,_,m,s))}return o.push(""),o}function Lr(r,e,t,s,n,o){return o?Cr(r,e,t,s,n):vr(r,e,t,s)}function _s(r,e,t,s,n){let o=[],i=Dr(r);for(let[a,d]of i)o.push(...Lr(a,d,e,t,s,n));return o}function ms(r,e,t){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function Es(r,e){let t=[];return e?(t.push(...Q("Investigated",r.investigated,p.blue)),t.push(...Q("Learned",r.learned,p.yellow)),t.push(...Q("Completed",r.completed,p.green)),t.push(...Q("Next Steps",r.next_steps,p.magenta))):(t.push(...J("Investigated",r.investigated)),t.push(...J("Learned",r.learned)),t.push(...J("Completed",r.completed)),t.push(...J("Next Steps",r.next_steps))),t}function gs(r,e){return e?os(r):Kt(r)}function Ts(r,e,t){return!_e(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:t?is(r.totalDiscoveryTokens,r.totalReadTokens):Wt(r.totalDiscoveryTokens,r.totalReadTokens)}var Mr=fs.default.join((0,bs.homedir)(),".claude","plugins","marketplaces","keepmind","plugin",".install-version");function xr(){try{return new ae}catch(r){if(r instanceof Error&&r.code==="ERR_DLOPEN_FAILED"){try{(0,Ss.unlinkSync)(Mr)}catch(e){e instanceof Error?l.debug("WORKER","Marker file cleanup failed (may not exist)",{},e):l.debug("WORKER","Marker file cleanup failed (may not exist)",{error:String(e)})}return l.error("WORKER","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function Pr(r,e){return e?as(r):Vt(r)}function wr(r,e,t,s,n,o,i){let a=[],d=Be(e);a.push(...ds(r,d,s,i));let c=t.slice(0,s.sessionCount),u=Mt(c,t),_=xt(e,u),m=Pt(e,s.fullObservationCount);a.push(..._s(_,m,s,n,i));let g=t[0],f=e[0];ms(s,g,f)&&a.push(...Es(g,i));let N=Lt(e,s,o,n);return a.push(...gs(N,i)),a.push(...Ts(d,s,i)),a.join(`
`).trimEnd()}var kr=new Set(["bugfix","discovery","decision","refactor","security_alert","security_note"]);function Ur(r,e,t){let s=Be(r),n={bugfix:0,discovery:0,decision:0,refactor:0,security_alert:0,security_note:0,other:0},o=new Set,i=Number.POSITIVE_INFINITY;for(let d of r){let c=kr.has(d.type)?d.type:"other";n[c]++,d.memory_session_id&&o.add(d.memory_session_id),d.created_at_epoch&&d.created_at_epoch<i&&(i=d.created_at_epoch)}let a=Number.isFinite(i)?Math.max(0,Math.floor((Date.now()-i)/864e5)):0;return{observation_count:r.length,session_count:o.size,timeline_depth_days:a,has_session_summary:e.length>0,obs_type_bugfix:n.bugfix,obs_type_discovery:n.discovery,obs_type_decision:n.decision,obs_type_refactor:n.refactor,obs_type_security_alert:n.security_alert,obs_type_security_note:n.security_note,obs_type_other:n.other,tokens_injected:s.totalReadTokens,tokens_saved_vs_naive:s.savings,search_strategy:t?"full":"timeline"}}async function Xe(r,e=!1){let t=Nt(),s=ne(),n=r?.cwd??process.cwd(),o=ht(n),i=r?.projects?.length?r.projects:o.allProjects,a=i[i.length-1]??o.primary,d=s.importance.enabled&&!r?.full,c=t.totalObservationCount;d&&(t.totalObservationCount=Math.max(c,c*Math.max(1,s.injection.candidateMultiplier))),r?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let u=xr();if(!u)return{text:"",stats:null};try{let _=r?.platformSource?D(r.platformSource):void 0,m=i.length>1?vt(u,i,t,_):yt(u,a,t,_),g=d?Ot(m,{tokenBudget:s.injection.tokenBudget,halfLifeDays:s.importance.halfLifeDays,maxRows:c}):m,f=i.length>1?Ct(u,i,t,_):Dt(u,a,t,_);return g.length>0&&u.markObservationsUsed(g.map(O=>O.id),"injection"),g.length===0&&f.length===0?{text:Pr(a,e),stats:null}:{text:wr(a,g,f,t,n,r?.session_id,e),stats:Ur(g,f,!!r?.full)}}finally{u.close()}}async function hs(r,e=!1){return(await Xe(r,e)).text}0&&(module.exports={generateContext,generateContextWithStats});
