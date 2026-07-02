"use strict";var ms=Object.create;var q=Object.defineProperty;var Es=Object.getOwnPropertyDescriptor;var gs=Object.getOwnPropertyNames;var Ts=Object.getPrototypeOf,fs=Object.prototype.hasOwnProperty;var bs=(r,e)=>{for(var t in e)q(r,t,{get:e[t],enumerable:!0})},He=(r,e,t,s)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of gs(e))!fs.call(r,n)&&n!==t&&q(r,n,{get:()=>e[n],enumerable:!(s=Es(e,n))||s.enumerable});return r};var G=(r,e,t)=>(t=r!=null?ms(Ts(r)):{},He(e||!r||!r.__esModule?q(t,"default",{value:r,enumerable:!0}):t,r)),Ss=r=>He(q({},"__esModule",{value:!0}),r);var Rr={};bs(Rr,{generateContext:()=>ps,generateContextWithStats:()=>Ge});module.exports=Ss(Rr);var cs=G(require("path"),1),ls=require("os"),_s=require("fs");var je=require("node:sqlite");function Be(r){return typeof r=="bigint"?Number(r):r}function hs(r){return r!==null&&typeof r=="object"&&!Array.isArray(r)&&!(r instanceof Uint8Array)&&!(typeof Buffer<"u"&&Buffer.isBuffer(r))}function Xe(r){return r===void 0?null:typeof r=="boolean"?r?1:0:r}function J(r){let e=r;if(e.length===1&&Array.isArray(e[0])&&(e=e[0]),e.length===1&&hs(e[0])){let t=e[0],s={};for(let n of Object.keys(t))s[n]=Xe(t[n]);return[s]}return e.map(Xe)}var ge=class{constructor(e){this.stmt=e}stmt;all(...e){return this.stmt.all(...J(e))}get(...e){return this.stmt.get(...J(e))??null}run(...e){let t=this.stmt.run(...J(e));return{changes:Be(t.changes),lastInsertRowid:Be(t.lastInsertRowid)}}values(...e){return this.stmt.all(...J(e)).map(s=>Object.values(s))}finalize(){}},H=class{db;queryCache=new Map;safeIntegers;txDepth=0;filename;constructor(e,t={}){let s=t.readonly===!0;this.safeIntegers=t.safeIntegers===!0;let n=e&&e.length>0?e:":memory:";if(this.filename=n,this.db=new je.DatabaseSync(n,{readOnly:s,allowExtension:!0}),!s&&n!==":memory:")try{this.db.exec("PRAGMA journal_mode=WAL")}catch{}}wrap(e){return this.safeIntegers&&e.setReadBigInts(!0),new ge(e)}prepare(e){return this.wrap(this.db.prepare(e))}query(e){let t=this.queryCache.get(e);if(t)return t;let s=this.prepare(e);return this.queryCache.set(e,s),s}run(e,...t){return t.length===0?(this.db.exec(e),{changes:0,lastInsertRowid:0}):this.prepare(e).run(...t)}exec(e){this.db.exec(e)}loadExtension(e,t){this.db.loadExtension(e)}transaction(e){return(...t)=>{let s=this.txDepth===0,n=`__cm_sp_${this.txDepth}`;s?this.db.exec("BEGIN"):this.db.exec(`SAVEPOINT ${n}`),this.txDepth++;try{let o=e(...t);return this.txDepth--,s?this.db.exec("COMMIT"):this.db.exec(`RELEASE ${n}`),o}catch(o){throw this.txDepth--,s?this.db.exec("ROLLBACK"):(this.db.exec(`ROLLBACK TO ${n}`),this.db.exec(`RELEASE ${n}`)),o}}}close(){this.db.close()}};var T=require("path"),Re=require("os"),v=require("fs");var We=require("url");var U=require("fs"),be=require("path");var Rs=null;function Os(r){return(Rs??process.stderr.write.bind(process.stderr))(r)}function Te(r){Os(r)}var As=14,Se=(o=>(o[o.DEBUG=0]="DEBUG",o[o.INFO=1]="INFO",o[o.WARN=2]="WARN",o[o.ERROR=3]="ERROR",o[o.SILENT=4]="SILENT",o))(Se||{}),fe=null,he=class{level=null;useColor;logFilePath=null;logFileInitialized=!1;constructor(){this.useColor=process.stdout.isTTY??!1}ensureLogFileInitialized(){if(!this.logFileInitialized){this.logFileInitialized=!0;try{let e=P.logsDir();(0,U.existsSync)(e)||(0,U.mkdirSync)(e,{recursive:!0});let t=new Date().toISOString().split("T")[0];this.logFilePath=(0,be.join)(e,`keepmind-${t}.log`),this.pruneOldLogs(e)}catch(e){console.error("[LOGGER] Failed to initialize log file:",e instanceof Error?e.message:String(e)),this.logFilePath=null}}}pruneOldLogs(e){try{let t=Date.now()-As*24*60*60*1e3;for(let s of(0,U.readdirSync)(e)){let n=/^keepmind-(\d{4}-\d{2}-\d{2})\.log$/.exec(s);if(!n)continue;let o=Date.parse(n[1]);if(Number.isFinite(o)&&o<t)try{(0,U.unlinkSync)((0,be.join)(e,s))}catch{}}}catch{}}getLevel(){if(this.level===null)try{let e=P.settings();if((0,U.existsSync)(e)){let t=(0,U.readFileSync)(e,"utf-8"),n=(JSON.parse(t).CLAUDE_MEM_LOG_LEVEL||"INFO").toUpperCase();this.level=Se[n]??1}else this.level=1}catch(e){console.error("[LOGGER] Failed to load log level from settings:",e instanceof Error?e.message:String(e)),this.level=1}return this.level}formatData(e){if(e==null)return"";if(typeof e=="string")return e;if(typeof e=="number"||typeof e=="boolean")return e.toString();if(typeof e=="object"){if(e instanceof Error)return this.getLevel()===0?`${e.message}
${e.stack}`:e.message;if(Array.isArray(e))return`[${e.length} items]`;let t=Object.keys(e);return t.length===0?"{}":t.length<=3?JSON.stringify(e):`{${t.length} keys: ${t.slice(0,3).join(", ")}...}`}return String(e)}formatTool(e,t){if(!t)return e;let s=t;if(typeof t=="string")try{s=JSON.parse(t)}catch{s=t}if(e==="Bash"&&s.command)return`${e}(${s.command})`;if(s.file_path)return`${e}(${s.file_path})`;if(s.notebook_path)return`${e}(${s.notebook_path})`;if(e==="Glob"&&s.pattern)return`${e}(${s.pattern})`;if(e==="Grep"&&s.pattern)return`${e}(${s.pattern})`;if(s.url)return`${e}(${s.url})`;if(s.query)return`${e}(${s.query})`;if(e==="Task"){if(s.subagent_type)return`${e}(${s.subagent_type})`;if(s.description)return`${e}(${s.description})`}return e==="Skill"&&s.skill?`${e}(${s.skill})`:e==="LSP"&&s.operation?`${e}(${s.operation})`:e}formatTimestamp(e){let t=e.getFullYear(),s=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0"),o=String(e.getHours()).padStart(2,"0"),i=String(e.getMinutes()).padStart(2,"0"),a=String(e.getSeconds()).padStart(2,"0"),d=String(e.getMilliseconds()).padStart(3,"0");return`${t}-${s}-${n} ${o}:${i}:${a}.${d}`}log(e,t,s,n,o){if(e<this.getLevel())return;this.ensureLogFileInitialized();let i=this.formatTimestamp(new Date),a=Se[e].padEnd(5),d=t.padEnd(6),u="";n?.correlationId?u=`[${n.correlationId}] `:n?.sessionId&&(u=`[session-${n.sessionId}] `);let c="";if(o!=null)if(o instanceof Error)c=this.getLevel()===0?`
${o.message}
${o.stack}`:` ${o.message}`;else if(this.getLevel()===0&&typeof o=="object")try{c=`
`+JSON.stringify(o,null,2)}catch{c=" "+this.formatData(o)}else c=" "+this.formatData(o);let m="";if(n){let{sessionId:g,memorySessionId:I,correlationId:A,...h}=n;Object.keys(h).length>0&&(m=` {${Object.entries(h).map(([y,D])=>`${y}=${D}`).join(", ")}}`)}let p=`[${i}] [${a}] [${d}] ${u}${s}${m}${c}`;if(this.logFilePath)try{(0,U.appendFileSync)(this.logFilePath,p+`
`,"utf8")}catch(g){Te(`[LOGGER] Failed to write to log file: ${g instanceof Error?g.message:String(g)}
`)}else Te(p+`
`)}debug(e,t,s,n){this.log(0,e,t,s,n)}info(e,t,s,n){this.log(1,e,t,s,n)}warn(e,t,s,n){this.log(2,e,t,s,n)}setErrorSink(e){fe=e}error(e,t,s,n){this.log(3,e,t,s,n),this.routeErrorToSink(t,s,n)}routeErrorToSink(e,t,s){try{if(!fe||!(s instanceof Error))return;fe(s)}catch{}}dataIn(e,t,s,n){this.info(e,`\u2192 ${t}`,s,n)}dataOut(e,t,s,n){this.info(e,`\u2190 ${t}`,s,n)}success(e,t,s,n){this.info(e,`\u2713 ${t}`,s,n)}failure(e,t,s,n){this.error(e,`\u2717 ${t}`,s,n)}happyPathError(e,t,s,n,o=""){let u=((new Error().stack||"").split(`
`)[2]||"").match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/),c=u?`${u[1].split("/").pop()}:${u[2]}`:"unknown",m={...s,location:c};return this.warn(e,`[HAPPY-PATH] ${t}`,m,n),o}},l=new he;var ws={};function Is(){return typeof __dirname<"u"?__dirname:(0,T.dirname)((0,We.fileURLToPath)(ws.url))}var Ns=Is();function Cs(){let r=process.env.KEEPMIND_DATA_DIR??process.env.CLAUDE_MEM_DATA_DIR;if(r)return r;let e=(0,T.join)((0,Re.homedir)(),".keepmind"),t=(0,T.join)(e,"settings.json");try{if((0,v.existsSync)(t)){let s=JSON.parse((0,v.readFileSync)(t,"utf-8")),n=s.env??s,o=n.KEEPMIND_DATA_DIR??n.CLAUDE_MEM_DATA_DIR;if(o)return o}}catch{}return e}var N=Cs(),$=process.env.CLAUDE_CONFIG_DIR||(0,T.join)((0,Re.homedir)(),".claude"),vr=(0,T.join)($,"plugins","marketplaces","keepmind"),Ls=(0,T.join)(N,"archives"),ys=(0,T.join)(N,"logs"),Ds=(0,T.join)(N,"trash"),vs=(0,T.join)(N,"backups"),Ms=(0,T.join)(N,"modes"),Mr=(0,T.join)(N,"settings.json"),k=(0,T.join)(N,"keepmind.db"),B=(0,T.join)(N,"claude-mem.db"),Us=(0,T.join)(N,"vector-db"),Ve=(0,T.join)(N,"observer-sessions"),Oe=(0,T.basename)(Ve),Ur=(0,T.join)($,"settings.json"),xr=(0,T.join)($,"commands"),wr=(0,T.join)($,"CLAUDE.md");function Ye(r){(0,v.mkdirSync)(r,{recursive:!0})}function xs(){try{if((0,v.existsSync)(k)||!(0,v.existsSync)(B))return(0,v.existsSync)(k);for(let r of["","-wal","-shm"]){let e=B+r,t=k+r;(0,v.existsSync)(e)&&!(0,v.existsSync)(t)&&(0,v.renameSync)(e,t)}return l.info("DB","Migrated legacy claude-mem.db to keepmind.db",{from:B,to:k}),!0}catch(r){return l.warn("DB","Could not rename legacy claude-mem.db to keepmind.db (file may be locked) \u2014 falling back to legacy path",{},r instanceof Error?r:new Error(String(r))),!1}}function Ae(){return xs(),!(0,v.existsSync)(k)&&(0,v.existsSync)(B)?B:k}function Ke(){return(0,T.join)(Ns,"..")}var P={dataDir:()=>N,workerPid:()=>(0,T.join)(N,"worker.pid"),workerPort:()=>(0,T.join)(N,"worker.port"),serverPid:()=>(0,T.join)(N,".server-beta.pid"),serverPort:()=>(0,T.join)(N,".server-beta.port"),serverRuntime:()=>(0,T.join)(N,".server-beta.runtime.json"),settings:()=>(0,T.join)(N,"settings.json"),database:()=>Ae(),chroma:()=>(0,T.join)(N,"chroma"),combinedCerts:()=>(0,T.join)(N,"combined_certs.pem"),transcriptsConfig:()=>(0,T.join)(N,"transcript-watch.json"),transcriptsState:()=>(0,T.join)(N,"transcript-watch-state.json"),corpora:()=>(0,T.join)(N,"corpora"),supervisorRegistry:()=>(0,T.join)(N,"supervisor.json"),envFile:()=>(0,T.join)(N,".env"),logsDir:()=>ys,archives:()=>Ls,trash:()=>Ds,backups:()=>vs,modes:()=>Ms,vectorDb:()=>Us,observerSessions:()=>Ve};var qe=require("crypto");function Ie(r,e,t){return(0,qe.createHash)("sha256").update([r||"",e||"",t||""].join("\0")).digest("hex").slice(0,16)}function Ne(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[String(e)]}catch{return[r]}}var Ce=r=>`\xABredacted:${r}\xBB`,ks=[{type:"PRIVATE_KEY",re:/-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,4000}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g},{type:"CONNECTION_STRING",re:/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]{1,200}/gi},{type:"AWS_KEY",re:/\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g},{type:"GITHUB_FINE_PAT",re:/\bgithub_pat_\w{82}\b/g},{type:"GITHUB_PAT",re:/\bghp_[0-9A-Za-z]{36}\b/g},{type:"GITLAB_PAT",re:/\bglpat-[\w-]{20}\b/g},{type:"SLACK_TOKEN",re:/\bxox[baprs]-[0-9A-Za-z-]{10,200}\b/g},{type:"GOOGLE_API_KEY",re:/\bAIza[\w-]{35}\b/g},{type:"STRIPE_KEY",re:/\b(?:sk|rk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}\b/g},{type:"JWT",re:/\bey[A-Za-z0-9_-]{17,500}\.ey[A-Za-z0-9_/\\-]{17,500}\.[A-Za-z0-9_/\\-]{10,500}={0,2}/g},{type:"BEARER",re:/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,500}/g},{type:"BCRYPT",re:/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g},{type:"GENERIC_SECRET",re:/(?:pass(?:word)?|secret|token|api[_-]?key|client[_-]?secret|auth)\b['"\s]{0,3}[:=>]{1,2}['"\s]{0,3}([\w./+=-]{10,150})/gi,group:1}];function Fs(r,e){if(e.re.lastIndex=0,e.group===void 0)return r.replace(e.re,Ce(e.type));let t=e.group;return r.replace(e.re,(s,...n)=>{let o=n[t-1];return typeof o!="string"||o.length===0?s:s.replace(o,Ce(e.type))})}function Ps(r){if(r.length===0)return 0;let e=new Map;for(let s of r)e.set(s,(e.get(s)??0)+1);let t=0;for(let s of e.values()){let n=s/r.length;t-=n*Math.log2(n)}return t}var $s=/^[0-9a-f]+$/i;function Gs(r,e){return r.length<20||r.length>200||/[\s]/.test(r)||!/\d/.test(r)||!/[A-Za-z]/.test(r)||r.includes("/")||r.includes("\\")||r.length<=64&&$s.test(r)||r.includes("redacted:")?!1:Ps(r)>=e}var Hs=/([\s"'`,;(){}\[\]<>]+)/;function Bs(r,e){let t=r.split(Hs);for(let s=0;s<t.length;s++){let n=t[s];n&&Gs(n,e)&&(t[s]=Ce("HIGH_ENTROPY"))}return t.join("")}function Le(r,e={}){if(typeof r!="string"||r.length===0)return r;try{let t=r;for(let s of ks)t=Fs(t,s);return e.entropySweep!==!1&&(t=Bs(t,e.entropyThreshold??4)),t}catch{return r}}function Q(r,e={}){if(typeof r=="string")return Le(r,e);if(Array.isArray(r))return r.map(t=>Q(t,e));if(r&&typeof r=="object"){let t={};for(let[s,n]of Object.entries(r))t[s]=Q(n,e);return t}return r}var Z=require("fs");var De={redactSecrets:{enabled:!0,entropyThreshold:4,entropySweep:!0},scoping:{enabled:!0,includeGlobal:!0,defaultSearchScope:"project"},importance:{enabled:!0,halfLifeDays:14,llmRefine:!1},injection:{tokenBudget:4e3,candidateMultiplier:3},reconcile:{enabled:!1,noopThreshold:.92,updateBand:.75,llmAdjudicate:!1,allowHardDelete:!1},supersession:{enabled:!1},expiry:{enabled:!1,ttlDays:28,importanceFloor:7,hardDelete:!1},optimizer:{enabled:!0,tickMinutes:5,vacuumHours:24}};function z(r){return!!r&&typeof r=="object"&&!Array.isArray(r)}function F(r,e){if(!z(e))return{...r};let t={...r};for(let s of Object.keys(r))e[s]!==void 0&&typeof e[s]==typeof r[s]&&(t[s]=e[s]);return t}var ye=null;function ee(r=!1){if(ye&&!r)return ye;let e=De,t;try{let o=P.settings();if((0,Z.existsSync)(o)){let i=JSON.parse((0,Z.readFileSync)(o,"utf-8").replace(/^﻿/,"")),a=z(i)?i.memoryQuality??(z(i.env)?i.env.memoryQuality:void 0):void 0;z(a)&&(t=a)}}catch(o){l.debug("CONFIG","memoryQuality config load failed; using defaults",{},o instanceof Error?o:new Error(String(o)))}let s={redactSecrets:F(e.redactSecrets,t?.redactSecrets),scoping:F(e.scoping,t?.scoping),importance:F(e.importance,t?.importance),injection:F(e.injection,t?.injection),reconcile:F(e.reconcile,t?.reconcile),supersession:F(e.supersession,t?.supersession),expiry:F(e.expiry,t?.expiry),optimizer:F(e.optimizer,t?.optimizer)},n=process.env.CLAUDE_MEM_REDACT_SECRETS;return(n==="0"||n==="false")&&(s.redactSecrets.enabled=!1),ye=s,s}var Xs={decision:9,bugfix:8,refactor:6,discovery:5,global:7,other:3,trivial:1};function js(r){if(Array.isArray(r))return r.length;if(typeof r=="string")try{let e=JSON.parse(r);return Array.isArray(e)?e.length:0}catch{return 0}return 0}function ve(r){let e=Xs[r.type??"other"]??4;return js(r.files_modified)>0&&(e+=1),(r.narrative?.length??0)<40&&(e-=1),/\b(TODO|FIXME|WIP)\b/i.test(r.narrative??"")&&(e-=1),Math.max(1,Math.min(10,e))}var Ws=14,Vs=864e5;function Je(r,e={}){let t=e.now??Date.now(),s=(e.halfLifeDays??Ws)*Vs,n=(r.importance??5)/10,o=Math.max(0,t-(r.created_at_epoch??t)),i=Math.pow(.5,o/s);return n*i}var Ys=new Set(["the","a","an","and","or","but","to","of","in","on","for","with","is","are","was","were","be","been","it","this","that","we","i","as","at","by","from","into","over","so","then","than","will"]);function te(r){return r?r.toLowerCase().replace(/[^a-z0-9\s]+/g," ").split(/\s+/).filter(e=>e.length>0&&!Ys.has(e)).join(" ").trim():""}function Qe(r){let e=new Set,t=r.replace(/\s+/g," ");for(let s=0;s+3<=t.length;s++)e.add(t.slice(s,s+3));return e}function Ks(r,e){let t=Qe(r),s=Qe(e);if(t.size===0&&s.size===0)return 1;if(t.size===0||s.size===0)return 0;let n=0;for(let o of t)s.has(o)&&n++;return n/(t.size+s.size-n)}function qs(r,e){let t=new Map,s=new Map;for(let a of r.split(" "))a&&t.set(a,(t.get(a)??0)+1);for(let a of e.split(" "))a&&s.set(a,(s.get(a)??0)+1);if(t.size===0||s.size===0)return 0;let n=0;for(let[a,d]of t)n+=d*(s.get(a)??0);let o=0;for(let a of t.values())o+=a*a;let i=0;for(let a of s.values())i+=a*a;return n/(Math.sqrt(o)*Math.sqrt(i)||1)}function Js(r,e){let t=te(`${r??""}`),s=te(`${e??""}`);return Math.max(Ks(t,s),qs(t,s))}function ze(r,e,t){let s=`${r.title??""} ${r.narrative??""}`,n={action:"ADD"},o=-1;for(let i of e){let a=Js(s,`${i.title??""} ${i.narrative??""}`);a<=o||(o=a,a>=t.noopThreshold?n={action:"NOOP",candidateId:i.id,score:a}:a>=t.updateBand&&t.supersessionEnabled?n={action:"UPDATE",candidateId:i.id,score:a}:n={action:"ADD",score:a})}return n}var Ze=require("crypto");function Me(r){let e=r.title??"";if(!e){if(Array.isArray(r.facts)&&r.facts.length>0)e=r.facts[0];else if(typeof r.facts=="string")try{let s=JSON.parse(r.facts);Array.isArray(s)&&s.length>0&&(e=String(s[0]))}catch{}}e||(e=(r.narrative??"").slice(0,80));let t=te(e);return(0,Ze.createHash)("sha1").update(t).digest("hex").slice(0,16)}var E="claude";function Qs(r){return r.trim().toLowerCase().replace(/\s+/g,"-")}function L(r){if(!r)return E;let e=Qs(r);return e?e==="transcript"||e.includes("codex")?"codex":e.includes("cursor")?"cursor":e.includes("claude")?"claude":e:E}function et(r){let e=["claude","codex","cursor"];return[...r].sort((t,s)=>{let n=e.indexOf(t),o=e.indexOf(s);return n!==-1||o!==-1?n===-1?1:o===-1?-1:n-o:t.localeCompare(s)})}function tt(r,e,t,s,n){let o=Date.now()-s,i=n!==void 0?"up.session_db_id = ?":"up.content_session_id = ?",a=n??e;return r.prepare(`
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
  `).get(a,t,o)??void 0}var nt=["private","claude-mem-context","system_instruction","system-instruction","persisted-output","system-reminder"],st=new RegExp(`<(${nt.join("|")})\\b[^>]*>[\\s\\S]*?</\\1>`,"g"),ot=/<system-reminder>[\s\S]*?<\/system-reminder>/g,rt=100;function zs(r){let e=Object.fromEntries(nt.map(n=>[n,0]));st.lastIndex=0;let t=0,s=r.replace(st,(n,o)=>(e[o]=(e[o]??0)+1,t+=1,""));return t>rt&&l.warn("SYSTEM","tag count exceeds limit",void 0,{tagCount:t,maxAllowed:rt,contentLength:r.length}),{stripped:s.trim(),counts:e}}function it(r){return zs(r).stripped}var Zs=["task-notification"],Qr=new RegExp(`^\\s*<(${Zs.join("|")})\\b[^>]*>(?:(?!<\\1\\b|</\\1\\b)[\\s\\S])*</\\1>\\s*$`),zr=256*1024;var Ue=4e3;function se(r){let e=r.trim(),s=it(r).trim()||e;return s.length<=Ue?s:(l.debug("DB","Truncated stored prompt text to the configured cap",{originalLength:s.length,storedLength:Ue}),`${s.slice(0,Ue-1)}\u2026`)}function er(r,e){return{customTitle:r,platformSource:e?L(e):void 0}}var re=class{db;redactEnabled;redactOpts;mq;rt(e){return this.redactEnabled?Le(e,this.redactOpts):e}rl(e){return this.redactEnabled?Q(e,this.redactOpts):e}constructor(e=k){try{this.mq=ee();let t=this.mq.redactSecrets;this.redactEnabled=t.enabled,this.redactOpts={entropySweep:t.entropySweep,entropyThreshold:t.entropyThreshold}}catch{this.mq=De,this.redactEnabled=process.env.CLAUDE_MEM_REDACT_SECRETS!=="0"&&process.env.CLAUDE_MEM_REDACT_SECRETS!=="false",this.redactOpts={entropySweep:!0,entropyThreshold:4}}if(e instanceof H)this.db=e;else{e!==":memory:"&&Ye(N);let t=e===k?Ae():e;this.db=new H(t),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA foreign_keys = ON"),this.db.run("PRAGMA journal_size_limit = 4194304")}this.initializeSchema(),this.ensureWorkerPortColumn(),this.ensurePromptTrackingColumns(),this.removeSessionSummariesUniqueConstraint(),this.addObservationHierarchicalFields(),this.makeObservationsTextNullable(),this.createUserPromptsTable(),this.ensureDiscoveryTokensColumn(),this.createPendingMessagesTable(),this.renameSessionIdColumns(),this.repairSessionIdColumnRename(),this.addFailedAtEpochColumn(),this.addOnUpdateCascadeToForeignKeys(),this.addObservationContentHashColumn(),this.addSessionCustomTitleColumn(),this.addSessionPlatformSourceColumn(),this.addObservationModelColumns(),this.ensureMergedIntoProjectColumns(),this.addObservationSubagentColumns(),this.addObservationsUniqueContentHashIndex(),this.addObservationsMetadataColumn(),this.dropDeadPendingMessagesColumns(),this.ensurePendingMessagesToolUseIdColumn(),this.dropWorkerPidColumn(),this.ensureSDKSessionsPlatformContentIdentity(),this.ensureUserPromptsSessionDbId(),this.ensurePendingMessagesSessionToolUniqueIndex(),this.addObservationImportanceColumn(),this.addObservationBitemporalColumns(),this.addObservationLastUsedColumn()}addObservationBitemporalColumns(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(37),t=this.db.query("PRAGMA table_info(observations)").all(),s=n=>t.some(o=>o.name===n);e&&s("valid_from")&&s("valid_to")&&s("subject_key")||(s("valid_from")||this.db.run("ALTER TABLE observations ADD COLUMN valid_from INTEGER"),s("valid_to")||this.db.run("ALTER TABLE observations ADD COLUMN valid_to INTEGER"),s("subject_key")||this.db.run("ALTER TABLE observations ADD COLUMN subject_key TEXT"),this.db.run("UPDATE observations SET valid_from = created_at_epoch WHERE valid_from IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_subject_valid ON observations(project, subject_key, valid_to)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(37,new Date().toISOString()))}addObservationLastUsedColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(38),s=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="last_used_at");e&&s||(s||this.db.run("ALTER TABLE observations ADD COLUMN last_used_at INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_obs_last_used ON observations(last_used_at)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(38,new Date().toISOString()))}addObservationImportanceColumn(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(36),s=this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="importance");e&&s||(s||this.db.run("ALTER TABLE observations ADD COLUMN importance INTEGER"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(36,new Date().toISOString()))}getIndexColumns(e){return this.db.query(`PRAGMA index_info(${JSON.stringify(e)})`).all().map(t=>t.name)}hasUniqueIndexOnColumns(e,t){return this.db.query(`PRAGMA index_list(${e})`).all().some(n=>{if(n.unique!==1)return!1;let o=this.getIndexColumns(n.name);return o.length===t.length&&o.every((i,a)=>i===t[a])})}resolvePromptSessionDbId(e,t,s){if(t!==void 0)return t;let n=s?L(s):void 0;return n?this.db.prepare(`
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
        `),this.db.run("DROP TABLE sdk_sessions"),this.db.run("ALTER TABLE sdk_sessions_new RENAME TO sdk_sessions"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString()),this.db.run("COMMIT")}catch(i){throw this.db.run("ROLLBACK"),i}finally{this.db.run("PRAGMA foreign_keys = ON")}return}this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)"),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(33,new Date().toISOString())}}ensureUserPromptsSessionDbId(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(34);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='user_prompts'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString());return}let n=this.db.query("PRAGMA table_info(user_prompts)").all().some(u=>u.name==="session_db_id"),i=this.db.query("PRAGMA foreign_key_list(user_prompts)").all().some(u=>u.table==="sdk_sessions"&&u.from==="content_session_id");if(e&&n&&!i)return;let a=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_prompts_fts'").all().length>0,d=n?`COALESCE(up.session_db_id, (
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
        `),this.db.run("INSERT INTO user_prompts_fts(user_prompts_fts) VALUES('rebuild')")),e||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(34,new Date().toISOString()),this.db.run("COMMIT")}catch(u){throw this.db.run("ROLLBACK"),u}finally{this.db.run("PRAGMA foreign_keys = ON")}}ensurePendingMessagesSessionToolUniqueIndex(){let e=this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(35);if(this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all().length===0){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(35,new Date().toISOString());return}let s=this.hasUniqueIndexOnColumns("pending_messages",["session_db_id","tool_use_id"]);if(!(e&&s)){this.db.run("BEGIN TRANSACTION");try{this.db.run("DROP INDEX IF EXISTS ux_pending_session_tool"),this.db.run(`
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
    `),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(16,new Date().toISOString()),l.debug("DB","pending_messages table created successfully")}renameSessionIdColumns(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(17))return;l.debug("DB","Checking session ID columns for semantic clarity rename");let t=0,s=(n,o,i)=>{let a=this.db.query(`PRAGMA table_info(${n})`).all(),d=a.some(c=>c.name===o);return a.some(c=>c.name===i)?!1:d?(this.db.run(`ALTER TABLE ${n} RENAME COLUMN ${o} TO ${i}`),l.debug("DB",`Renamed ${n}.${o} to ${i}`),!0):(l.warn("DB",`Column ${o} not found in ${n}, skipping rename`),!1)};s("sdk_sessions","claude_session_id","content_session_id")&&t++,s("sdk_sessions","sdk_session_id","memory_session_id")&&t++,s("pending_messages","claude_session_id","content_session_id")&&t++,s("observations","sdk_session_id","memory_session_id")&&t++,s("session_summaries","sdk_session_id","memory_session_id")&&t++,s("user_prompts","claude_session_id","content_session_id")&&t++,this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(17,new Date().toISOString()),t>0?l.debug("DB",`Successfully renamed ${t} session ID columns`):l.debug("DB","No session ID column renames needed (already up to date)")}repairSessionIdColumnRename(){this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(19)||this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(19,new Date().toISOString())}addFailedAtEpochColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(20))return;this.db.query("PRAGMA table_info(pending_messages)").all().some(n=>n.name==="failed_at_epoch")||(this.db.run("ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER"),l.debug("DB","Added failed_at_epoch column to pending_messages table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(20,new Date().toISOString())}addOnUpdateCascadeToForeignKeys(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(21))return;l.debug("DB","Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries"),this.db.run("PRAGMA foreign_keys = OFF"),this.db.run("BEGIN TRANSACTION"),this.db.run("DROP TRIGGER IF EXISTS observations_ai"),this.db.run("DROP TRIGGER IF EXISTS observations_ad"),this.db.run("DROP TRIGGER IF EXISTS observations_au"),this.db.run("DROP TABLE IF EXISTS observations_new");let t=this.db.query("PRAGMA table_info(observations)").all(),s=t.some(S=>S.name==="metadata"),n=t.some(S=>S.name==="content_hash"),o=s?`,
        metadata TEXT`:"",i=s?", metadata":"",a=n?`,
        content_hash TEXT`:"",d=n?", content_hash":"",u=`
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
    `,c=`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             discovery_tokens, created_at, created_at_epoch${i}${d}
      FROM observations
    `,m=`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `,p=`
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
    `,I=`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, discovery_tokens, created_at, created_at_epoch
      FROM session_summaries
    `,A=`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `,h=`
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
    `;try{this.recreateObservationsWithCascade(u,c,m,p),this.recreateSessionSummariesWithCascade(g,I,A,h),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(21,new Date().toISOString()),this.db.run("COMMIT"),this.db.run("PRAGMA foreign_keys = ON"),l.debug("DB","Successfully added ON UPDATE CASCADE to FK constraints")}catch(S){throw this.db.run("ROLLBACK"),this.db.run("PRAGMA foreign_keys = ON"),S instanceof Error?S:new Error(String(S))}}recreateObservationsWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE observations"),this.db.run("ALTER TABLE observations_new RENAME TO observations"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run(n)}recreateSessionSummariesWithCascade(e,t,s,n){this.db.run(e),this.db.run(t),this.db.run("DROP TABLE session_summaries"),this.db.run("ALTER TABLE session_summaries_new RENAME TO session_summaries"),this.db.run(s),this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all().length>0&&this.db.run(n)}addObservationContentHashColumn(){if(this.db.query("PRAGMA table_info(observations)").all().some(s=>s.name==="content_hash")){this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString());return}this.db.run("ALTER TABLE observations ADD COLUMN content_hash TEXT"),this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL"),this.db.run("CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)"),l.debug("DB","Added content_hash column to observations table with backfill and index"),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(22,new Date().toISOString())}addSessionCustomTitleColumn(){if(this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(23))return;this.db.query("PRAGMA table_info(sdk_sessions)").all().some(n=>n.name==="custom_title")||(this.db.run("ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT"),l.debug("DB","Added custom_title column to sdk_sessions table")),this.db.prepare("INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)").run(23,new Date().toISOString())}addSessionPlatformSourceColumn(){let t=this.db.query("PRAGMA table_info(sdk_sessions)").all().some(i=>i.name==="platform_source"),n=this.db.query("PRAGMA index_list(sdk_sessions)").all().some(i=>i.name==="idx_sdk_sessions_platform_source");this.db.prepare("SELECT version FROM schema_versions WHERE version = ?").get(24)&&t&&n||(t||(this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${E}'`),l.debug("DB","Added platform_source column to sdk_sessions table")),this.db.run(`
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
    `).all(e)}getAllProjects(e){let t=e?L(e):void 0,s=`
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `,n=[Oe];return t&&(s+=" AND COALESCE(platform_source, ?) = ?",n.push(E,t)),s+=" ORDER BY project ASC",this.db.prepare(s).all(...n).map(i=>i.project)}getProjectCatalog(){let e=this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${E}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${E}'), project
      ORDER BY latest_epoch DESC
    `).all(Oe),t=[],s=new Set,n={};for(let i of e){let a=L(i.platform_source);n[a]||(n[a]=[]),n[a].includes(i.project)||n[a].push(i.project),s.has(i.project)||(s.add(i.project),t.push(i.project))}let o=et(Object.keys(n));return{projects:t,sources:o,projectsBySource:Object.fromEntries(o.map(i=>[i,n[i]||[]]))}}getLatestUserPrompt(e,t){let s=this.resolvePromptSessionDbId(e,t),n=s!==null?"up.session_db_id = ?":"up.content_session_id = ?",o=s!==null?s:e;return this.db.prepare(`
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
    `).get(o)}findRecentDuplicateUserPrompt(e,t,s,n){return tt(this.db,e,se(t),s,this.resolvePromptSessionDbId(e,n)??void 0)}getRecentSessionsWithStatus(e,t=3,s){let n=[e],o="";return s&&(o=`AND COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`,n.push(L(s))),n.push(t),this.db.prepare(`
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
      `,s.push(L(t))),this.db.prepare(`
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
    `).get(e,L(t))||null:this.db.prepare(`
        SELECT *
        FROM observations
        WHERE id = ?
      `).get(e)||null}getObservationsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,platformSource:i,type:a,concepts:d,files:u}=t,c=s==="relevance",m=c?"":`ORDER BY o.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,p=n&&!c?`LIMIT ${n}`:"",g=e.map(()=>"?").join(","),I=[...e],A=[];if(o&&(A.push("o.project = ?"),I.push(o)),i&&(A.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),I.push(L(i))),a)if(Array.isArray(a)){let R=a.map(()=>"?").join(",");A.push(`o.type IN (${R})`),I.push(...a)}else A.push("o.type = ?"),I.push(a);if(d){let R=Array.isArray(d)?d:[d],b=R.map(()=>"EXISTS (SELECT 1 FROM json_each(o.concepts) WHERE value = ?)");I.push(...R),A.push(`(${b.join(" OR ")})`)}if(u){let R=Array.isArray(u)?u:[u],b=R.map(()=>"(EXISTS (SELECT 1 FROM json_each(o.files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(o.files_modified) WHERE value LIKE ?))");R.forEach(C=>{I.push(`%${C}%`,`%${C}%`)}),A.push(`(${b.join(" OR ")})`)}let h=A.length>0?`WHERE o.id IN (${g}) AND ${A.join(" AND ")}`:`WHERE o.id IN (${g})`,y=this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      ${h}
      ${m}
      ${p}
    `).all(...I);if(!c)return y;let D=new Map(y.map(R=>[R.id,R])),f=e.map(R=>D.get(R)).filter(R=>!!R);return n?f.slice(0,n):f}getSummaryForSession(e,t){let s=[e],n="";return t&&(n=`
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions sdk
          WHERE sdk.memory_session_id = session_summaries.memory_session_id
            AND COALESCE(NULLIF(sdk.platform_source, ''), '${E}') = ?
        )
      `,s.push(L(t))),this.db.prepare(`
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
    `).all(e),n=new Set,o=new Set;for(let i of s)Ne(i.files_read).forEach(a=>n.add(a)),Ne(i.files_modified).forEach(a=>o.add(a));return{filesRead:Array.from(n),filesModified:Array.from(o)}}getSessionById(e){return this.db.prepare(`
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
    `).get(e).count}createSDKSession(e,t,s,n,o){let i=new Date,a=i.getTime(),d=er(n,o),u=d.platformSource??E,c=this.rt(se(s)),m=this.db.prepare(`
      SELECT id, platform_source
      FROM sdk_sessions
      WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
        AND content_session_id = ?
    `).get(E,u,e);if(m)return t&&this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE id = ? AND (project IS NULL OR project = '')
        `).run(t,m.id),d.customTitle&&this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE id = ? AND custom_title IS NULL
        `).run(d.customTitle,m.id),m.id;let p=this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(e,t,u,c,d.customTitle||null,i.toISOString(),a);return Number(p.lastInsertRowid)}saveUserPrompt(e,t,s,n){let o=new Date,i=o.getTime(),a=this.rt(se(s)),d=this.resolvePromptSessionDbId(e,n);return this.db.prepare(`
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
    `).get(e,t)?.prompt_text??null}storeObservation(e,t,s,n,o=0,i,a){let d=i??Date.now(),u=new Date(d).toISOString(),c=this.rt(s.title),m=this.rt(s.subtitle),p=this.rt(s.narrative),g=this.rl(s.facts),I=this.rt(s.metadata??null),A=Ie(e,c??null,p??null),h=ve({type:s.type,narrative:p,files_modified:s.files_modified}),S;if(this.mq.reconcile.enabled){let R=this.reconcileBeforeInsert(t,s.type,c??null,p??null);if(R.action==="NOOP"&&R.candidateId){let b=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE id = ?").get(R.candidateId);if(b)return{id:b.id,createdAtEpoch:b.created_at_epoch}}else R.action==="UPDATE"&&(S=R.candidateId)}let D=this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
       generated_by_model, metadata, importance, valid_from, subject_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_session_id, content_hash) DO NOTHING
      RETURNING id, created_at_epoch
    `).get(e,t,s.type,c,m,JSON.stringify(g),p,JSON.stringify(s.concepts),JSON.stringify(s.files_read),JSON.stringify(s.files_modified),n||null,o,s.agent_type??null,s.agent_id??null,A,u,d,a||null,I,h,d,Me({title:c??null,facts:g,narrative:p??null}));if(D)return S!==void 0&&this.mq.supersession.enabled&&this.supersedeObservation(S,D.id,d),{id:D.id,createdAtEpoch:D.created_at_epoch};let f=this.db.prepare("SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?").get(e,A);if(!f)throw new Error(`storeObservation: ON CONFLICT without existing row for content_hash=${A}`);return{id:f.id,createdAtEpoch:f.created_at_epoch}}storeSummary(e,t,s,n,o=0,i){let a=i??Date.now(),d=new Date(a).toISOString(),c=this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(e,t,this.rt(s.request),this.rt(s.investigated),this.rt(s.learned),this.rt(s.completed),this.rt(s.next_steps),this.rt(s.notes),n||null,o,d,a);return{id:Number(c.lastInsertRowid),createdAtEpoch:a}}storeObservations(e,t,s,n,o,i=0,a,d){let u=a??Date.now(),c=new Date(u).toISOString();return this.db.transaction(()=>{let p=[],g=this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model, importance, valid_from, subject_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `),I=this.db.prepare("SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?");for(let h of s){let S=this.rt(h.title),y=this.rt(h.subtitle),D=this.rt(h.narrative),f=this.rl(h.facts),R=Ie(e,S??null,D??null),b=g.get(e,t,h.type,S,y,JSON.stringify(f),D,JSON.stringify(h.concepts),JSON.stringify(h.files_read),JSON.stringify(h.files_modified),o||null,i,h.agent_type??null,h.agent_id??null,R,c,u,d||null,ve({type:h.type,narrative:D,files_modified:h.files_modified}),u,Me({title:S??null,facts:f,narrative:D??null}));if(b){p.push(b.id);continue}let C=I.get(e,R);if(!C)throw new Error(`storeObservations: ON CONFLICT without existing row for content_hash=${R}`);p.push(C.id)}let A=null;if(n){let S=this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(e,t,this.rt(n.request),this.rt(n.investigated),this.rt(n.learned),this.rt(n.completed),this.rt(n.next_steps),this.rt(n.notes),o||null,i,c,u);A=Number(S.lastInsertRowid)}return{observationIds:p,summaryId:A,createdAtEpoch:u}})()}markObservationsUsed(e,t=Date.now()){if(e.length!==0)try{if(!this.db.query("PRAGMA table_info(observations)").all().some(o=>o.name==="last_used_at"))return;let n=e.map(()=>"?").join(",");this.db.prepare(`UPDATE observations SET last_used_at = ? WHERE id IN (${n})`).run(t,...e)}catch(s){l.debug("DB","markObservationsUsed failed",{count:e.length},s instanceof Error?s:new Error(String(s)))}}evaporateScratch(e){try{let t=this.db.prepare("DELETE FROM observations WHERE memory_session_id = ? AND type = 'scratch'").run(e),s=Number(t.changes??0);return s>0&&l.info("DB","Evaporated scratch observations at SessionEnd",{memorySessionId:e,count:s}),s}catch(t){return l.warn("DB","evaporateScratch failed",{memorySessionId:e},t instanceof Error?t:new Error(String(t))),0}}reconcileBeforeInsert(e,t,s,n){try{let o=Date.now()-7776e6,i=this.db.query("PRAGMA table_info(observations)").all().some(m=>m.name==="valid_to"),a=i?"AND valid_to IS NULL":"",d=this.db.prepare(`
        SELECT id, title, narrative, importance
        FROM observations
        WHERE project = ? AND type = ? AND created_at_epoch >= ? ${a}
        ORDER BY created_at_epoch DESC
        LIMIT 20
      `).all(e,t,o);if(d.length===0)return{action:"ADD"};let u=this.mq.supersession.enabled&&i;return ze({title:s,narrative:n},d,{noopThreshold:this.mq.reconcile.noopThreshold,updateBand:this.mq.reconcile.updateBand,supersessionEnabled:u})}catch(o){return l.warn("DB","reconcileBeforeInsert failed; defaulting to ADD",{project:e,type:t},o instanceof Error?o:new Error(String(o))),{action:"ADD"}}}supersedeObservation(e,t,s){try{this.db.prepare(`
        UPDATE observations
           SET valid_to = ?,
               metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?)
         WHERE id = ? AND valid_to IS NULL
      `).run(s,t,e)}catch(n){l.warn("DB","supersedeObservation failed",{oldId:e,newId:t},n instanceof Error?n:new Error(String(n)))}}getObservationsAsOf(e,t){return this.db.query("PRAGMA table_info(observations)").all().some(n=>n.name==="valid_from")?this.db.prepare(`
      SELECT * FROM observations
      WHERE project = ?
        AND COALESCE(valid_from, created_at_epoch) <= ?
        AND (valid_to IS NULL OR valid_to > ?)
    `).all(e,t,t):this.db.prepare("SELECT * FROM observations WHERE project = ?").all(e)}deleteObservationsByProject(e,t={}){let s=(e??"").trim();if(s===""||s==="*")throw new Error(`deleteObservationsByProject: refusing unsafe project '${e}'`);let n=this.db.prepare("SELECT count(*) AS c FROM observations WHERE project = ?").get(s).c,o=this.db.prepare("SELECT count(*) AS c FROM session_summaries WHERE project = ?").get(s).c;if(t.dryRun)return{project:s,dryRun:!0,observationsDeleted:n,summariesDeleted:o};this.db.transaction(()=>{this.db.prepare("DELETE FROM observations WHERE project = ?").run(s),this.db.prepare("DELETE FROM session_summaries WHERE project = ?").run(s)})();try{this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}catch(a){l.warn("DB","observations_fts rebuild after project delete failed",{project:s},a instanceof Error?a:new Error(String(a)))}return l.info("DB","Deleted observations by project",{project:s,observationsDeleted:n,summariesDeleted:o}),{project:s,dryRun:!1,observationsDeleted:n,summariesDeleted:o}}getSessionSummariesByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,platformSource:i}=t,a=s==="relevance",d=a?"":`ORDER BY ss.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,u=n&&!a?`LIMIT ${n}`:"",c=e.map(()=>"?").join(","),m=[...e],p=[];o&&(p.push("ss.project = ?"),m.push(o)),i&&(p.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),m.push(L(i)));let g=p.length>0?`AND ${p.join(" AND ")}`:"",A=this.db.prepare(`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON s.memory_session_id = ss.memory_session_id
      WHERE ss.id IN (${c}) ${g}
      ${d}
      ${u}
    `).all(...m);if(!a)return A;let h=new Map(A.map(y=>[y.id,y])),S=e.map(y=>h.get(y)).filter(y=>!!y);return n?S.slice(0,n):S}getUserPromptsByIds(e,t={}){if(e.length===0)return[];let{orderBy:s="date_desc",limit:n,project:o,platformSource:i}=t,a=s==="relevance",d=a?"":`ORDER BY up.created_at_epoch ${s==="date_asc"?"ASC":"DESC"}`,u=n?`LIMIT ${n}`:"",c=e.map(()=>"?").join(","),m=[...e],p=[];o&&(p.push("s.project = ?"),m.push(o)),i&&(p.push(`COALESCE(NULLIF(s.platform_source, ''), '${E}') = ?`),m.push(L(i)));let g=p.length>0?`AND ${p.join(" AND ")}`:"",A=this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.id IN (${c}) ${g}
      ${d}
      ${u}
    `).all(...m);if(!a)return A;let h=new Map(A.map(S=>[S.id,S]));return e.map(S=>h.get(S)).filter(S=>!!S)}getTimelineAroundTimestamp(e,t=10,s=10,n,o){return this.getTimelineAroundObservation(null,e,t,s,n,o)}getTimelineAroundObservation(e,t,s=10,n=10,o,i){let a=i?L(i):void 0,d=(f,R)=>{let b=[],C=[];return o&&(b.push(`${f}.project = ?`),C.push(o)),a&&(b.push(`COALESCE(NULLIF(${R}.platform_source, ''), '${E}') = ?`),C.push(a)),{clause:b.length>0?`AND ${b.join(" AND ")}`:"",params:C}},u=d("o","src"),c=d("ss","src"),m=d("s","s"),p,g;if(e!==null){let f=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id <= ? ${u.clause}
        ORDER BY o.id DESC
        LIMIT ?
      `,R=`
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id >= ? ${u.clause}
        ORDER BY o.id ASC
        LIMIT ?
      `;try{let b=this.db.prepare(f).all(e,...u.params,s+1),C=this.db.prepare(R).all(e,...u.params,n+1);if(b.length===0&&C.length===0)return{observations:[],sessions:[],prompts:[]};p=b.length>0?b[b.length-1].created_at_epoch:t,g=C.length>0?C[C.length-1].created_at_epoch:t}catch(b){return b instanceof Error?l.error("DB","Error getting boundary observations",{project:o},b):l.error("DB","Error getting boundary observations with non-Error",{},new Error(String(b))),{observations:[],sessions:[],prompts:[]}}}else{let f=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch <= ? ${u.clause}
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `,R=`
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch >= ? ${u.clause}
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `;try{let b=this.db.prepare(f).all(t,...u.params,s),C=this.db.prepare(R).all(t,...u.params,n+1);if(b.length===0&&C.length===0)return{observations:[],sessions:[],prompts:[]};p=b.length>0?b[b.length-1].created_at_epoch:t,g=C.length>0?C[C.length-1].created_at_epoch:t}catch(b){return b instanceof Error?l.error("DB","Error getting boundary timestamps",{project:o},b):l.error("DB","Error getting boundary timestamps with non-Error",{},new Error(String(b))),{observations:[],sessions:[],prompts:[]}}}let I=`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
      WHERE o.created_at_epoch >= ? AND o.created_at_epoch <= ? ${u.clause}
      ORDER BY o.created_at_epoch ASC
    `,A=`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions src ON src.memory_session_id = ss.memory_session_id
      WHERE ss.created_at_epoch >= ? AND ss.created_at_epoch <= ? ${c.clause}
      ORDER BY ss.created_at_epoch ASC
    `,h=`
      SELECT up.*, s.project, s.memory_session_id, COALESCE(NULLIF(s.platform_source, ''), '${E}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${m.clause}
      ORDER BY up.created_at_epoch ASC
    `,S=this.db.prepare(I).all(p,g,...u.params),y=this.db.prepare(A).all(p,g,...c.params),D=this.db.prepare(h).all(p,g,...m.params);return{observations:S,sessions:y.map(f=>({id:f.id,memory_session_id:f.memory_session_id,project:f.project,request:f.request,completed:f.completed,next_steps:f.next_steps,created_at:f.created_at,created_at_epoch:f.created_at_epoch})),prompts:D.map(f=>({id:f.id,content_session_id:f.content_session_id,prompt_number:f.prompt_number,prompt_text:f.prompt_text,project:f.project,platform_source:f.platform_source,created_at:f.created_at,created_at_epoch:f.created_at_epoch}))}}getPromptById(e){return this.db.prepare(`
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
    `).run(t,s,e,E,o.toISOString(),o.getTime()),l.info("SESSION","Created manual session",{memorySessionId:t,project:e}),t}close(){this.db.close()}importSdkSession(e){let t=L(e.platform_source),s=this.db.prepare(`SELECT id FROM sdk_sessions
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
    `).run(e.memory_session_id,e.project,e.text,e.type,e.title,e.subtitle,e.facts,e.narrative,e.concepts,e.files_read,e.files_modified,e.prompt_number,e.discovery_tokens||0,e.agent_type??null,e.agent_id??null,e.created_at,e.created_at_epoch).lastInsertRowid}}rebuildObservationsFTSIndex(){this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all().length>0&&this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')")}importUserPrompt(e){let t=null,s=e.platform_source?L(e.platform_source):void 0;if(typeof e.session_db_id=="number"){let a=this.db.prepare(`
        SELECT id, content_session_id, COALESCE(NULLIF(platform_source, ''), '${E}') as platform_source
        FROM sdk_sessions
        WHERE id = ?
        LIMIT 1
      `).get(e.session_db_id);a&&a.content_session_id===e.content_session_id&&(!s||L(a.platform_source)===s)&&(t=a.id)}t===null&&(t=this.resolvePromptSessionDbId(e.content_session_id,void 0,s));let n=this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE ${t!==null?"session_db_id = ?":"content_session_id = ?"} AND prompt_number = ?
    `).get(t??e.content_session_id,e.prompt_number);return n?{imported:!1,id:n.id}:{imported:!0,id:this.db.prepare(`
      INSERT INTO user_prompts (
        session_db_id, content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(t,e.content_session_id,e.prompt_number,e.prompt_text,e.created_at,e.created_at_epoch).lastInsertRowid}}};var dt=require("os"),ut=G(require("path"),1),ct=require("child_process");var oe=require("fs"),ne=G(require("path"),1);var X={isWorktree:!1,worktreeName:null,parentRepoPath:null,parentProjectName:null};function at(r){let e=ne.default.join(r,".git"),t;try{t=(0,oe.statSync)(e)}catch(c){return c instanceof Error&&c.code!=="ENOENT"&&l.warn("GIT","Unexpected error checking .git",{error:c instanceof Error?c.message:String(c)}),X}if(!t.isFile())return X;let s;try{s=(0,oe.readFileSync)(e,"utf-8").trim()}catch(c){return l.warn("GIT","Failed to read .git file",{error:c instanceof Error?c.message:String(c)}),X}let n=s.match(/^gitdir:\s*(.+)$/);if(!n)return X;let i=n[1].match(/^(.+)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)$/);if(!i)return X;let a=i[1],d=ne.default.basename(r),u=ne.default.basename(a);return{isWorktree:!0,worktreeName:d,parentRepoPath:a,parentProjectName:u}}function lt(r){return r==="~"||r.startsWith("~/")?r.replace(/^~/,(0,dt.homedir)()):r}function tr(r){try{return(0,ct.execFileSync)("git",["rev-parse","--show-toplevel"],{cwd:r,encoding:"utf-8",stdio:["ignore","pipe","ignore"]}).trim()||null}catch{return null}}function sr(r){if(!r||r.trim()==="")return l.warn("PROJECT_NAME","Empty cwd provided, using fallback",{cwd:r}),"unknown-project";let e=lt(r),s=tr(e)??e,n=ut.default.basename(s);if(n===""){if(process.platform==="win32"){let i=r.match(/^([A-Z]):\\/i);if(i){let d=`drive-${i[1].toUpperCase()}`;return l.info("PROJECT_NAME","Drive root detected",{cwd:r,projectName:d}),d}}return l.warn("PROJECT_NAME","Root directory detected, using fallback",{cwd:r}),"unknown-project"}return n}function _t(r){let e=sr(r);if(!r)return{primary:e,parent:null,isWorktree:!1,allProjects:[e]};let t=lt(r),s=at(t);if(s.isWorktree&&s.parentProjectName){let n=`${s.parentProjectName}/${e}`;return{primary:n,parent:s.parentProjectName,isWorktree:!0,allProjects:[s.parentProjectName,n]}}return{primary:e,parent:null,isWorktree:!1,allProjects:[e]}}var w=require("fs"),j=require("path"),we=require("os");var xe={DEFAULT:3e5,HEALTH_CHECK:3e3,API_REQUEST:3e4,HOOK_READINESS_WAIT:1e4,POST_SPAWN_WAIT:15e3,READINESS_WAIT:3e4,PORT_IN_USE_WAIT:3e3,WORKER_STARTUP_WAIT:1e3,PRE_RESTART_SETTLE_DELAY:2e3,POWERSHELL_COMMAND:1e4,WINDOWS_MULTIPLIER:1.5};function pt(r){return process.platform==="win32"?Math.round(r*xe.WINDOWS_MULTIPLIER):r}var O=require("fs");var x=require("path");var mt=require("crypto");var rr=process.platform==="win32";function nr(r){(0,O.existsSync)(r)||(0,O.mkdirSync)(r,{recursive:!0})}function ie(r,e){let t=r;try{if((0,O.lstatSync)(r).isSymbolicLink())try{t=(0,O.realpathSync)(r)}catch{let u=(0,O.readlinkSync)(r);t=(0,x.resolve)((0,x.dirname)(r),u)}}catch(u){let c=u.code;if(c!=="ENOENT"&&c!=="ENOTDIR")throw u}nr((0,x.dirname)(t));let s=(0,x.dirname)(t),n=(0,x.basename)(t),o=(0,x.join)(s,`.${n}.${process.pid}.${(0,mt.randomBytes)(6).toString("hex")}.tmp`),i=Buffer.from(JSON.stringify(e,null,2)+`
`,"utf-8"),a;try{a=(0,O.statSync)(t).mode&511}catch{}let d;try{d=a!==void 0?(0,O.openSync)(o,"w",a):(0,O.openSync)(o,"w");let u=0;for(;u<i.length;){let c=(0,O.writeSync)(d,i,u,i.length-u);if(c===0)throw new Error(`writeSync stalled at ${u}/${i.length} bytes`);u+=c}if((0,O.fsyncSync)(d),(0,O.closeSync)(d),d=void 0,(0,O.renameSync)(o,t),!rr){let c;try{c=(0,O.openSync)(s,"r"),(0,O.fsyncSync)(c)}catch{}finally{if(c!==void 0)try{(0,O.closeSync)(c)}catch{}}}}catch(u){if(d!==void 0)try{(0,O.closeSync)(d)}catch{}try{(0,O.unlinkSync)(o)}catch{}throw u}}var ae=class{static DEFAULTS={CLAUDE_MEM_MODEL:"claude-haiku-4-5-20251001",CLAUDE_MEM_CONTEXT_OBSERVATIONS:"50",CLAUDE_MEM_WORKER_PORT:String(37700+(process.getuid?.()??77)%100),CLAUDE_MEM_WORKER_HOST:"127.0.0.1",CLAUDE_MEM_API_TIMEOUT_MS:String(pt(xe.API_REQUEST)),CLAUDE_MEM_SKIP_TOOLS:"ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",CLAUDE_MEM_PROVIDER:"claude",CLAUDE_MEM_CLAUDE_AUTH_METHOD:"subscription",CLAUDE_MEM_GEMINI_API_KEY:"",CLAUDE_MEM_GEMINI_MODEL:"gemini-2.5-flash-lite",CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED:"true",CLAUDE_MEM_GEMINI_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_GEMINI_MAX_TOKENS:"100000",CLAUDE_MEM_OPENROUTER_API_KEY:"",CLAUDE_MEM_OPENROUTER_MODEL:"xiaomi/mimo-v2-flash:free",CLAUDE_MEM_OPENROUTER_BASE_URL:"",CLAUDE_MEM_OPENROUTER_SITE_URL:"",CLAUDE_MEM_OPENROUTER_APP_NAME:"claude-mem",CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES:"20",CLAUDE_MEM_OPENROUTER_MAX_TOKENS:"100000",CLAUDE_MEM_DATA_DIR:(0,j.join)((0,we.homedir)(),".keepmind"),CLAUDE_MEM_LOG_LEVEL:"INFO",CLAUDE_MEM_PYTHON_VERSION:"3.13",CLAUDE_CODE_PATH:"",CLAUDE_MEM_MODE:"code",CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT:"false",CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT:"true",CLAUDE_MEM_CONTEXT_FULL_COUNT:"0",CLAUDE_MEM_CONTEXT_FULL_FIELD:"narrative",CLAUDE_MEM_CONTEXT_SESSION_COUNT:"5",CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY:"true",CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE:"false",CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT:"true",CLAUDE_MEM_WELCOME_HINT_ENABLED:"true",CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED:"false",CLAUDE_MEM_FOLDER_USE_LOCAL_MD:"false",CLAUDE_MEM_TRANSCRIPTS_ENABLED:"true",CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH:(0,j.join)((0,we.homedir)(),".keepmind","transcript-watch.json"),CLAUDE_MEM_CODEX_TRANSCRIPT_INGESTION:"false",CLAUDE_MEM_MAX_CONCURRENT_AGENTS:"2",CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD:"3",CLAUDE_MEM_EXCLUDED_PROJECTS:"",CLAUDE_MEM_FOLDER_MD_EXCLUDE:"[]",CLAUDE_MEM_FOLDER_MD_SKELETON_DENYLIST:"[]",CLAUDE_MEM_SEMANTIC_INJECT:"false",CLAUDE_MEM_SEMANTIC_INJECT_LIMIT:"5",CLAUDE_MEM_TIER_ROUTING_ENABLED:"true",CLAUDE_MEM_TIER_SIMPLE_MODEL:"haiku",CLAUDE_MEM_TIER_SUMMARY_MODEL:"",CLAUDE_MEM_TIER_FAST_MODEL:"haiku",CLAUDE_MEM_TIER_SMART_MODEL:"sonnet",CLAUDE_MEM_CHROMA_ENABLED:"true",CLAUDE_MEM_TELEGRAM_ENABLED:"true",CLAUDE_MEM_TELEGRAM_BOT_TOKEN:"",CLAUDE_MEM_TELEGRAM_CHAT_ID:"",CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES:"security_alert",CLAUDE_MEM_TELEGRAM_TRIGGER_CONCEPTS:"",CLAUDE_MEM_QUEUE_ENGINE:"sqlite",CLAUDE_MEM_REDIS_URL:"",CLAUDE_MEM_REDIS_HOST:"127.0.0.1",CLAUDE_MEM_REDIS_PORT:"6379",CLAUDE_MEM_REDIS_MODE:"external",CLAUDE_MEM_QUEUE_REDIS_PREFIX:`claude_mem_${process.env.CLAUDE_MEM_WORKER_PORT??String(37700+(process.getuid?.()??77)%100)}`,CLAUDE_MEM_AUTH_MODE:"api-key",CLAUDE_MEM_RUNTIME:"worker",CLAUDE_MEM_SERVER_URL:`http://127.0.0.1:${process.env.CLAUDE_MEM_SERVER_PORT??String(37877+(process.getuid?.()??77)%100)}`,CLAUDE_MEM_SERVER_API_KEY:"",CLAUDE_MEM_SERVER_PROJECT_ID:"",CLAUDE_MEM_SERVER_BETA_URL:`http://127.0.0.1:${process.env.CLAUDE_MEM_SERVER_PORT??String(37877+(process.getuid?.()??77)%100)}`,CLAUDE_MEM_SERVER_BETA_API_KEY:"",CLAUDE_MEM_SERVER_BETA_PROJECT_ID:""};static getAllDefaults(){return{...this.DEFAULTS}}static envOverride(e){let t=e.replace(/^CLAUDE_MEM_/,"KEEPMIND_");return process.env[t]??process.env[e]}static get(e){return this.envOverride(e)??this.DEFAULTS[e]}static getInt(e){let t=this.get(e);return parseInt(t,10)}static getBool(e){let t=this.get(e);return t==="true"||t===!0}static applyEnvOverrides(e){let t={...e};for(let s of Object.keys(this.DEFAULTS)){let n=this.envOverride(s);n!==void 0&&(t[s]=n)}return t}static loadFromFile(e,t=!0){try{if(!(0,w.existsSync)(e)){let a=this.getAllDefaults();try{let d=(0,j.dirname)(e);(0,w.existsSync)(d)||(0,w.mkdirSync)(d,{recursive:!0}),ie(e,a),console.warn("[SETTINGS] Created settings file with defaults:",e)}catch(d){console.warn("[SETTINGS] Failed to create settings file, using in-memory defaults:",e,d instanceof Error?d.message:String(d))}return t?this.applyEnvOverrides(a):a}let s=(0,w.readFileSync)(e,"utf-8"),n=JSON.parse(s.replace(/^\uFEFF/,"")),o=n;if(n.env&&typeof n.env=="object"){o=n.env;try{ie(e,o),console.warn("[SETTINGS] Migrated settings file from nested to flat schema:",e)}catch(a){console.warn("[SETTINGS] Failed to auto-migrate settings file:",e,a instanceof Error?a.message:String(a))}}let i={...this.DEFAULTS};for(let a of Object.keys(this.DEFAULTS))o[a]!==void 0&&(i[a]=o[a]);return t?this.applyEnvOverrides(i):i}catch(s){console.warn("[SETTINGS] Failed to load settings, using defaults:",e,s instanceof Error?s.message:String(s));let n=this.getAllDefaults();try{if((0,w.existsSync)(e)){let o=`${e}.corrupt-${Date.now()}`;(0,w.renameSync)(e,o),console.warn("[SETTINGS] Backed up corrupt settings file to:",o)}ie(e,n),console.warn("[SETTINGS] Recovered settings file with defaults:",e)}catch(o){console.warn("[SETTINGS] Failed to recover corrupt settings file:",e,o instanceof Error?o.message:String(o))}return t?this.applyEnvOverrides(n):n}}};var W=require("fs"),de=require("path");var M=class r{static instance=null;activeMode=null;modesDir;constructor(){let e=Ke(),t=[...process.env.CLAUDE_MEM_MODES_DIR?[process.env.CLAUDE_MEM_MODES_DIR]:[],(0,de.join)(e,"modes"),(0,de.join)(e,"..","plugin","modes")],s=t.find(n=>(0,W.existsSync)(n));this.modesDir=s||t[0]}static getInstance(){return r.instance||(r.instance=new r),r.instance}parseInheritance(e){let t=e.split("--");if(t.length===1)return{hasParent:!1,parentId:"",overrideId:""};if(t.length>2)throw new Error(`Invalid mode inheritance: ${e}. Only one level of inheritance supported (parent--override)`);return{hasParent:!0,parentId:t[0],overrideId:e}}isPlainObject(e){return e!==null&&typeof e=="object"&&!Array.isArray(e)}deepMerge(e,t){let s={...e};for(let n in t){let o=t[n],i=e[n];this.isPlainObject(o)&&this.isPlainObject(i)?s[n]=this.deepMerge(i,o):s[n]=o}return s}loadModeFile(e){let t=(0,de.join)(this.modesDir,`${e}.json`);if(!(0,W.existsSync)(t))throw new Error(`Mode file not found: ${t}`);let s=(0,W.readFileSync)(t,"utf-8");return JSON.parse(s)}loadMode(e){let t=this.parseInheritance(e);if(!t.hasParent)try{let d=this.loadModeFile(e);return this.activeMode=d,l.debug("SYSTEM",`Loaded mode: ${d.name} (${e})`,void 0,{types:d.observation_types.map(u=>u.id),concepts:d.observation_concepts.map(u=>u.id)}),d}catch(d){if(d instanceof Error?l.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{message:d.message}):l.warn("WORKER",`Mode file not found: ${e}, falling back to 'code'`,{error:String(d)}),e==="code")throw new Error("Critical: code.json mode file missing");return this.loadMode("code")}let{parentId:s,overrideId:n}=t,o;try{o=this.loadMode(s)}catch(d){d instanceof Error?l.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{message:d.message}):l.warn("WORKER",`Parent mode '${s}' not found for ${e}, falling back to 'code'`,{error:String(d)}),o=this.loadMode("code")}let i;try{i=this.loadModeFile(n),l.debug("SYSTEM",`Loaded override file: ${n} for parent ${s}`)}catch(d){return d instanceof Error?l.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{message:d.message}):l.warn("WORKER",`Override file '${n}' not found, using parent mode '${s}' only`,{error:String(d)}),this.activeMode=o,o}if(!i)return l.warn("SYSTEM",`Invalid override file: ${n}, using parent mode '${s}' only`),this.activeMode=o,o;let a=this.deepMerge(o,i);return this.activeMode=a,l.debug("SYSTEM",`Loaded mode with inheritance: ${a.name} (${e} = ${s} + ${n})`,void 0,{parent:s,override:n,types:a.observation_types.map(d=>d.id),concepts:a.observation_concepts.map(d=>d.id)}),a}getActiveMode(){if(!this.activeMode)throw new Error("No mode loaded. Call loadMode() first.");return this.activeMode}getObservationTypes(){return this.getActiveMode().observation_types}getTypeIcon(e){return this.getObservationTypes().find(s=>s.id===e)?.emoji||"\u{1F4DD}"}getWorkEmoji(e){return this.getObservationTypes().find(s=>s.id===e)?.work_emoji||"\u{1F4DD}"}};function Et(){let r=P.settings(),e=ae.loadFromFile(r),t=M.getInstance().getActiveMode(),s=new Set(t.observation_types.map(o=>o.id)),n=new Set(t.observation_concepts.map(o=>o.id));return{totalObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_OBSERVATIONS,10),fullObservationCount:parseInt(e.CLAUDE_MEM_CONTEXT_FULL_COUNT,10),sessionCount:parseInt(e.CLAUDE_MEM_CONTEXT_SESSION_COUNT,10),showReadTokens:e.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS==="true",showWorkTokens:e.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS==="true",showSavingsAmount:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT==="true",showSavingsPercent:e.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT==="true",observationTypes:s,observationConcepts:n,fullObservationField:e.CLAUDE_MEM_CONTEXT_FULL_FIELD,showLastSummary:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY==="true",showLastMessage:e.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE==="true"}}var _={reset:"\x1B[0m",bright:"\x1B[1m",dim:"\x1B[2m",cyan:"\x1B[36m",green:"\x1B[32m",yellow:"\x1B[33m",blue:"\x1B[34m",magenta:"\x1B[35m",gray:"\x1B[90m",red:"\x1B[31m"},gt=4,ke=1;function ue(r){let e=(r.title?.length||0)+(r.subtitle?.length||0)+(r.narrative?.length||0)+JSON.stringify(r.facts||[]).length;return Math.ceil(e/gt)}function Fe(r){let e=r.length,t=r.reduce((i,a)=>i+ue(a),0),s=r.reduce((i,a)=>i+(a.discovery_tokens||0),0),n=s-t,o=s>0?Math.round(n/s*100):0;return{totalObservations:e,totalReadTokens:t,totalDiscoveryTokens:s,savings:n,savingsPercent:o}}function or(r){return M.getInstance().getWorkEmoji(r)}function V(r,e){let t=ue(r),s=r.discovery_tokens||0,n=or(r.type),o=s>0?`${n} ${s.toLocaleString("en-US")}`:"-";return{readTokens:t,discoveryTokens:s,discoveryDisplay:o,workEmoji:n}}function ce(r){return r.showReadTokens||r.showWorkTokens||r.showSavingsAmount||r.showSavingsPercent}function ir(r){return ue(r)}function ar(r,e){if(!Number.isFinite(e)||e<=0)return r;let t=[],s=0;for(let n of r){let o=ir(n);s+o>e||(t.push(n),s+=o)}return t}function Tt(r,e){let t=e.now??Date.now(),s=r.map(i=>({o:i,score:Je(i,{now:t,halfLifeDays:e.halfLifeDays})})).sort((i,a)=>a.score-i.score).map(i=>i.o),n=e.maxRows>0?s.slice(0,e.maxRows):s;return ar(n,e.tokenBudget).sort((i,a)=>(a.created_at_epoch??0)-(i.created_at_epoch??0))}var ft=G(require("path"),1),le=require("fs");function bt(r,e,t,s){let n=Array.from(t.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(t.observationConcepts),a=i.map(()=>"?").join(",");return r.db.prepare(`
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
  `).all(e,e,s??null,s??null,...n,...i,t.totalObservationCount)}function St(r,e,t,s){return r.db.prepare(`
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
  `).all(e,e,s??null,s??null,t.sessionCount+ke)}function ht(r,e,t,s){let n=Array.from(t.observationTypes),o=n.map(()=>"?").join(","),i=Array.from(t.observationConcepts),a=i.map(()=>"?").join(","),d=e.map(()=>"?").join(",");return r.db.prepare(`
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
  `).all(...e,...e,s??null,s??null,...n,...i,t.totalObservationCount)}function Rt(r,e,t,s){let n=e.map(()=>"?").join(",");return r.db.prepare(`
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
  `).all(...e,...e,s??null,s??null,t.sessionCount+ke)}function dr(r){return r.replace(/[/.]/g,"-")}function ur(r){if(!r.includes('"type":"assistant"'))return null;let e=JSON.parse(r);if(e.type==="assistant"&&e.message?.content&&Array.isArray(e.message.content)){let t="";for(let s of e.message.content)s.type==="text"&&(t+=s.text);if(t=t.replace(ot,"").trim(),t)return t}return null}function cr(r){for(let e=r.length-1;e>=0;e--)try{let t=ur(r[e]);if(t)return t}catch(t){t instanceof Error?l.debug("WORKER","Skipping malformed transcript line",{lineIndex:e},t):l.debug("WORKER","Skipping malformed transcript line",{lineIndex:e,error:String(t)});continue}return""}function lr(r){try{if(!(0,le.existsSync)(r))return{assistantMessage:""};let e=(0,le.readFileSync)(r,"utf-8").trim();if(!e)return{assistantMessage:""};let t=e.split(`
`).filter(n=>n.trim());return{assistantMessage:cr(t)}}catch(e){return e instanceof Error?l.failure("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r},e):l.warn("WORKER","Failed to extract prior messages from transcript",{transcriptPath:r,error:String(e)}),{assistantMessage:""}}}function Ot(r,e,t,s){if(!e.showLastMessage||r.length===0)return{assistantMessage:""};let n=r.find(d=>d.memory_session_id!==t);if(!n)return{assistantMessage:""};let o=n.memory_session_id,i=dr(s),a=ft.default.join($,"projects",i,`${o}.jsonl`);return lr(a)}function At(r,e){let t=e[0]?.id;return r.map((s,n)=>{let o=n===0?null:e[n+1];return{...s,displayEpoch:o?o.created_at_epoch:s.created_at_epoch,displayTime:o?o.created_at:s.created_at,shouldShowLink:s.id!==t}})}function It(r,e){let t=[...r.map(s=>({type:"observation",data:s})),...e.map(s=>({type:"summary",data:s}))];return t.sort((s,n)=>{let o=s.type==="observation"?s.data.created_at_epoch:s.data.displayEpoch,i=n.type==="observation"?n.data.created_at_epoch:n.data.displayEpoch;return o-i}),t}function Nt(r,e){return new Set(r.slice(0,e).map(t=>t.id))}function Lt(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function yt(r){return[`# [${r}] recent context, ${Lt()}`,""]}function Dt(){return[`Legend: \u{1F3AF}session ${M.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji}${t.id}`).join(" ")}`,"Format: ID TIME TYPE TITLE","Fetch details: get_observations([IDs]) | Search: mem-search skill",""]}function vt(r,e){let t=[],s=[`${r.totalObservations} obs (${r.totalReadTokens.toLocaleString("en-US")}t read)`,`${r.totalDiscoveryTokens.toLocaleString("en-US")}t work`];return r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)&&(e.showSavingsPercent?s.push(`${r.savingsPercent}% savings`):e.showSavingsAmount&&s.push(`${r.savings.toLocaleString("en-US")}t saved`)),t.push(`Stats: ${s.join(" | ")}`),t.push(""),t}function Mt(r){return[`### ${r}`]}function Ut(r){return r.toLowerCase().replace(" am","a").replace(" pm","p")}function xt(r,e,t){let s=r.title||"Untitled",n=M.getInstance().getTypeIcon(r.type),o=e?Ut(e):'"';return`${r.id} ${o} ${n} ${s}`}function wt(r,e,t,s){let n=[],o=r.title||"Untitled",i=M.getInstance().getTypeIcon(r.type),a=e?Ut(e):'"',{readTokens:d,discoveryDisplay:u}=V(r,s);n.push(`**${r.id}** ${a} ${i} **${o}**`),t&&n.push(t);let c=[];return s.showReadTokens&&c.push(`~${d}t`),s.showWorkTokens&&c.push(u),c.length>0&&n.push(c.join(" ")),n.push(""),n}function kt(r,e){return[`S${r.id} ${r.request||"Session started"} (${e})`]}var Ct=200;function Y(r,e){if(!e)return[];let t=e.length>Ct?`${e.slice(0,Ct).trimEnd()}\u2026`:e;return[`**${r}**: ${t}`,""]}function Ft(r){return r.assistantMessage?["","---","","**Previously**","",`A: ${r.assistantMessage}`,""]:[]}function Pt(r,e){return["",`Access ${Math.round(r/1e3)}k tokens of past work via get_observations([IDs]) or mem-search skill.`]}function $t(r){return`# [${r}] recent context, ${Lt()}

No previous sessions found.`}function Gt(){let r=new Date,e=r.toLocaleDateString("en-CA"),t=r.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0}).toLowerCase().replace(" ",""),s=r.toLocaleTimeString("en-US",{timeZoneName:"short"}).split(" ").pop();return`${e} ${t} ${s}`}function Ht(r){return["",`${_.bright}${_.cyan}[${r}] recent context, ${Gt()}${_.reset}`,`${_.gray}${"\u2500".repeat(60)}${_.reset}`,""]}function Bt(){let e=M.getInstance().getActiveMode().observation_types.map(t=>`${t.emoji} ${t.id}`).join(" | ");return[`${_.dim}Legend: session-request | ${e}${_.reset}`,""]}function Xt(){return[`${_.bright}Column Key${_.reset}`,`${_.dim}  Read: Tokens to read this observation (cost to learn it now)${_.reset}`,`${_.dim}  Work: Tokens spent on work that produced this record ( research, building, deciding)${_.reset}`,""]}function jt(){return[`${_.dim}Context Index: This semantic index (titles, types, files, tokens) is usually sufficient to understand past work.${_.reset}`,"",`${_.dim}When you need implementation details, rationale, or debugging context:${_.reset}`,`${_.dim}  - Fetch by ID: get_observations([IDs]) for observations visible in this index${_.reset}`,`${_.dim}  - Search history: Use the mem-search skill for past decisions, bugs, and deeper research${_.reset}`,`${_.dim}  - Trust this index over re-reading code for past decisions and learnings${_.reset}`,""]}function Wt(r,e){let t=[];if(t.push(`${_.bright}${_.cyan}Context Economics${_.reset}`),t.push(`${_.dim}  Loading: ${r.totalObservations} observations (${r.totalReadTokens.toLocaleString()} tokens to read)${_.reset}`),t.push(`${_.dim}  Work investment: ${r.totalDiscoveryTokens.toLocaleString()} tokens spent on research, building, and decisions${_.reset}`),r.totalDiscoveryTokens>0&&(e.showSavingsAmount||e.showSavingsPercent)){let s="  Your savings: ";e.showSavingsAmount&&e.showSavingsPercent?s+=`${r.savings.toLocaleString()} tokens (${r.savingsPercent}% reduction from reuse)`:e.showSavingsAmount?s+=`${r.savings.toLocaleString()} tokens`:s+=`${r.savingsPercent}% reduction from reuse`,t.push(`${_.green}${s}${_.reset}`)}return t.push(""),t}function Vt(r){return[`${_.bright}${_.cyan}${r}${_.reset}`,""]}function Yt(r){return[`${_.dim}${r}${_.reset}`]}function Kt(r,e,t,s){let n=r.title||"Untitled",o=M.getInstance().getTypeIcon(r.type),{readTokens:i,discoveryTokens:a,workEmoji:d}=V(r,s),u=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),c=s.showReadTokens&&i>0?`${_.dim}(~${i}t)${_.reset}`:"",m=s.showWorkTokens&&a>0?`${_.dim}(${d} ${a.toLocaleString()}t)${_.reset}`:"";return`  ${_.dim}#${r.id}${_.reset}  ${u}  ${o}  ${n} ${c} ${m}`}function qt(r,e,t,s,n){let o=[],i=r.title||"Untitled",a=M.getInstance().getTypeIcon(r.type),{readTokens:d,discoveryTokens:u,workEmoji:c}=V(r,n),m=t?`${_.dim}${e}${_.reset}`:" ".repeat(e.length),p=n.showReadTokens&&d>0?`${_.dim}(~${d}t)${_.reset}`:"",g=n.showWorkTokens&&u>0?`${_.dim}(${c} ${u.toLocaleString()}t)${_.reset}`:"";return o.push(`  ${_.dim}#${r.id}${_.reset}  ${m}  ${a}  ${_.bright}${i}${_.reset}`),s&&o.push(`    ${_.dim}${s}${_.reset}`),(p||g)&&o.push(`    ${p} ${g}`),o.push(""),o}function Jt(r,e){let t=`${r.request||"Session started"} (${e})`;return[`${_.yellow}#S${r.id}${_.reset} ${t}`,""]}function K(r,e,t){return e?[`${t}${r}:${_.reset} ${e}`,""]:[]}function Qt(r){return r.assistantMessage?["","---","",`${_.bright}${_.magenta}Previously${_.reset}`,"",`${_.dim}A: ${r.assistantMessage}${_.reset}`,""]:[]}function zt(r,e){let t=Math.round(r/1e3);return["",`${_.dim}Access ${t}k tokens of past research & decisions for just ${e.toLocaleString()}t. Use the claude-mem skill to access memories by ID.${_.reset}`]}function Zt(r){return`
${_.bright}${_.cyan}[${r}] recent context, ${Gt()}${_.reset}
${_.gray}${"\u2500".repeat(60)}${_.reset}

${_.dim}No previous sessions found for this project yet.${_.reset}
`}function es(r,e,t,s){let n=[];return s?n.push(...Ht(r)):n.push(...yt(r)),s?n.push(...Bt()):n.push(...Dt()),s&&(n.push(...Xt()),n.push(...jt())),ce(t)&&(s?n.push(...Wt(e,t)):n.push(...vt(e,t))),n}var me=G(require("path"),1);function Ee(r){if(!r)return[];try{let e=JSON.parse(r);return Array.isArray(e)?e:[]}catch(e){return l.debug("PARSER","Failed to parse JSON array, using empty fallback",{preview:r?.substring(0,50)},e instanceof Error?e:new Error(String(e))),[]}}function Pe(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",hour12:!0})}function $e(r){return new Date(r).toLocaleString("en-US",{hour:"numeric",minute:"2-digit",hour12:!0})}function ss(r){return new Date(r).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric"})}function ts(r,e){return me.default.isAbsolute(r)?me.default.relative(e,r).split(me.default.sep).join("/"):r}function rs(r,e,t){let s=Ee(r);if(s.length>0)return ts(s[0],e);if(t){let n=Ee(t);if(n.length>0)return ts(n[0],e)}return"General"}function _r(r){let e=new Map;for(let s of r){let n=s.type==="observation"?s.data.created_at:s.data.displayTime,o=ss(n);e.has(o)||e.set(o,[]),e.get(o).push(s)}let t=Array.from(e.entries()).sort((s,n)=>{let o=new Date(s[0]).getTime(),i=new Date(n[0]).getTime();return o-i});return new Map(t)}function ns(r,e){return e.fullObservationField==="narrative"?r.narrative:r.facts?Ee(r.facts).join(`
`):null}function pr(r,e,t,s){let n=[];n.push(...Mt(r));let o="";for(let i of e)if(i.type==="summary"){let a=i.data,d=Pe(a.displayTime);n.push(...kt(a,d))}else{let a=i.data,d=$e(a.created_at),c=d!==o?d:"";if(o=d,t.has(a.id)){let p=ns(a,s);n.push(...wt(a,c,p,s))}else n.push(xt(a,c,s))}return n}function mr(r,e,t,s,n){let o=[];o.push(...Vt(r));let i=null,a="";for(let d of e)if(d.type==="summary"){i=null,a="";let u=d.data,c=Pe(u.displayTime);o.push(...Jt(u,c))}else{let u=d.data,c=rs(u.files_modified,n,u.files_read),m=$e(u.created_at),p=m!==a;a=m;let g=t.has(u.id);if(c!==i&&(o.push(...Yt(c)),i=c),g){let I=ns(u,s);o.push(...qt(u,m,p,I,s))}else o.push(Kt(u,m,p,s))}return o.push(""),o}function Er(r,e,t,s,n,o){return o?mr(r,e,t,s,n):pr(r,e,t,s)}function os(r,e,t,s,n){let o=[],i=_r(r);for(let[a,d]of i)o.push(...Er(a,d,e,t,s,n));return o}function is(r,e,t){return!(!r.showLastSummary||!e||!!!(e.investigated||e.learned||e.completed||e.next_steps)||t&&e.created_at_epoch<=t.created_at_epoch)}function as(r,e){let t=[];return e?(t.push(...K("Investigated",r.investigated,_.blue)),t.push(...K("Learned",r.learned,_.yellow)),t.push(...K("Completed",r.completed,_.green)),t.push(...K("Next Steps",r.next_steps,_.magenta))):(t.push(...Y("Investigated",r.investigated)),t.push(...Y("Learned",r.learned)),t.push(...Y("Completed",r.completed)),t.push(...Y("Next Steps",r.next_steps))),t}function ds(r,e){return e?Qt(r):Ft(r)}function us(r,e,t){return!ce(e)||r.totalDiscoveryTokens<=0||r.savings<=0?[]:t?zt(r.totalDiscoveryTokens,r.totalReadTokens):Pt(r.totalDiscoveryTokens,r.totalReadTokens)}var gr=cs.default.join((0,ls.homedir)(),".claude","plugins","marketplaces","keepmind","plugin",".install-version");function Tr(){try{return new re}catch(r){if(r instanceof Error&&r.code==="ERR_DLOPEN_FAILED"){try{(0,_s.unlinkSync)(gr)}catch(e){e instanceof Error?l.debug("WORKER","Marker file cleanup failed (may not exist)",{},e):l.debug("WORKER","Marker file cleanup failed (may not exist)",{error:String(e)})}return l.error("WORKER","Native module rebuild needed - restart Claude Code to auto-fix"),null}throw r}}function fr(r,e){return e?Zt(r):$t(r)}function br(r,e,t,s,n,o,i){let a=[],d=Fe(e);a.push(...es(r,d,s,i));let u=t.slice(0,s.sessionCount),c=At(u,t),m=It(e,c),p=Nt(e,s.fullObservationCount);a.push(...os(m,p,s,n,i));let g=t[0],I=e[0];is(s,g,I)&&a.push(...as(g,i));let A=Ot(e,s,o,n);return a.push(...ds(A,i)),a.push(...us(d,s,i)),a.join(`
`).trimEnd()}var Sr=new Set(["bugfix","discovery","decision","refactor"]);function hr(r,e,t){let s=Fe(r),n={bugfix:0,discovery:0,decision:0,refactor:0,other:0},o=new Set,i=Number.POSITIVE_INFINITY;for(let d of r){let u=Sr.has(d.type)?d.type:"other";n[u]++,d.memory_session_id&&o.add(d.memory_session_id),d.created_at_epoch&&d.created_at_epoch<i&&(i=d.created_at_epoch)}let a=Number.isFinite(i)?Math.max(0,Math.floor((Date.now()-i)/864e5)):0;return{observation_count:r.length,session_count:o.size,timeline_depth_days:a,has_session_summary:e.length>0,obs_type_bugfix:n.bugfix,obs_type_discovery:n.discovery,obs_type_decision:n.decision,obs_type_refactor:n.refactor,obs_type_other:n.other,tokens_injected:s.totalReadTokens,tokens_saved_vs_naive:s.savings,search_strategy:t?"full":"timeline"}}async function Ge(r,e=!1){let t=Et(),s=ee(),n=r?.cwd??process.cwd(),o=_t(n),i=r?.projects?.length?r.projects:o.allProjects,a=i[i.length-1]??o.primary,d=s.importance.enabled&&!r?.full,u=t.totalObservationCount;d&&(t.totalObservationCount=Math.max(u,u*Math.max(1,s.injection.candidateMultiplier))),r?.full&&(t.totalObservationCount=999999,t.sessionCount=999999);let c=Tr();if(!c)return{text:"",stats:null};try{let m=r?.platformSource?L(r.platformSource):void 0,p=i.length>1?ht(c,i,t,m):bt(c,a,t,m),g=d?Tt(p,{tokenBudget:s.injection.tokenBudget,halfLifeDays:s.importance.halfLifeDays,maxRows:u}):p,I=i.length>1?Rt(c,i,t,m):St(c,a,t,m);return s.expiry.enabled&&g.length>0&&c.markObservationsUsed(g.map(h=>h.id)),g.length===0&&I.length===0?{text:fr(a,e),stats:null}:{text:br(a,g,I,t,n,r?.session_id,e),stats:hr(g,I,!!r?.full)}}finally{c.close()}}async function ps(r,e=!1){return(await Ge(r,e)).text}0&&(module.exports={generateContext,generateContextWithStats});
