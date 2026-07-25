🌐 Dette er en automatisk oversættelse. Fællesskabsrettelser er velkomne!

---
<h1 align="center">
  <br>
  <a href="https://github.com/ManuelStaggl/keepmind">
    keepmind
  </a>
  <br>
</h1>

<p align="center">
  <a href="README.zh.md">🇨🇳 中文</a> •
  <a href="README.zh-tw.md">🇹🇼 繁體中文</a> •
  <a href="README.ja.md">🇯🇵 日本語</a> •
  <a href="README.pt-br.md">🇧🇷 Português</a> •
  <a href="README.ko.md">🇰🇷 한국어</a> •
  <a href="README.es.md">🇪🇸 Español</a> •
  <a href="README.de.md">🇩🇪 Deutsch</a> •
  <a href="README.fr.md">🇫🇷 Français</a>
  <a href="README.he.md">🇮🇱 עברית</a> •
  <a href="README.ar.md">🇸🇦 العربية</a> •
  <a href="README.ru.md">🇷🇺 Русский</a> •
  <a href="README.pl.md">🇵🇱 Polski</a> •
  <a href="README.cs.md">🇨🇿 Čeština</a> •
  <a href="README.nl.md">🇳🇱 Nederlands</a> •
  <a href="README.tr.md">🇹🇷 Türkçe</a> •
  <a href="README.uk.md">🇺🇦 Українська</a> •
  <a href="README.vi.md">🇻🇳 Tiếng Việt</a> •
  <a href="README.id.md">🇮🇩 Indonesia</a> •
  <a href="README.th.md">🇹🇭 ไทย</a> •
  <a href="README.hi.md">🇮🇳 हिन्दी</a> •
  <a href="README.bn.md">🇧🇩 বাংলা</a> •
  <a href="README.ur.md">🇵🇰 اردو</a> •
  <a href="README.ro.md">🇷🇴 Română</a> •
  <a href="README.sv.md">🇸🇪 Svenska</a> •
  <a href="README.it.md">🇮🇹 Italiano</a> •
  <a href="README.el.md">🇬🇷 Ελληνικά</a> •
  <a href="README.hu.md">🇭🇺 Magyar</a> •
  <a href="README.fi.md">🇫🇮 Suomi</a> •
  <a href="README.da.md">🇩🇰 Dansk</a> •
  <a href="README.no.md">🇳🇴 Norsk</a>
</p>

<h4 align="center">Vedvarende hukommelseskomprimeringsystem bygget til <a href="https://claude.com/claude-code" target="_blank">Claude Code</a>.</h4>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" alt="License">
  </a>
  <a href="package.json">
    <img src="https://img.shields.io/badge/version-13.4.0-green.svg" alt="Version">
  </a>
  <a href="package.json">
    <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg" alt="Node">
  </a>
  <a href="https://github.com/thedotmack/awesome-claude-code">
    <img src="https://awesome.re/mentioned-badge.svg" alt="Mentioned in Awesome Claude Code">
  </a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/15496" target="_blank">
    keepmind
  </a>
</p>

<br>

<p align="center">
  <a href="https://github.com/ManuelStaggl/keepmind">
    keepmind
  </a>
</p>

<p align="center">
  <a href="#hurtig-start">Hurtig Start</a> •
  <a href="#sådan-virker-det">Sådan Virker Det</a> •
  <a href="#søgeværktøjer-via-mcp">Søgeværktøjer</a> •
  <a href="#dokumentation">Dokumentation</a> •
  <a href="#konfiguration">Konfiguration</a> •
  <a href="#fejlfinding">Fejlfinding</a> •
  <a href="#licens">Licens</a>
</p>

<p align="center">
  keepmind bevarer problemfrit kontekst på tværs af sessioner ved automatisk at fange observationer af værktøjsbrug, generere semantiske resuméer og gøre dem tilgængelige for fremtidige sessioner. Dette gør det muligt for Claude at opretholde kontinuitet i viden om projekter, selv efter sessioner afsluttes eller genopretter forbindelse.
</p>

---

## Hurtig Start

Start en ny Claude Code-session i terminalen og indtast følgende kommandoer:

```
> /plugin marketplace add ManuelStaggl/keepmind

> /plugin install keepmind
```

Genstart Claude Code. Kontekst fra tidligere sessioner vil automatisk vises i nye sessioner.

**Nøglefunktioner:**

- 🧠 **Vedvarende Hukommelse** - Kontekst overlever på tværs af sessioner
- 📊 **Progressiv Afsløring** - Lagdelt hukommelseshentning med synlighed af token-omkostninger
- 🔍 **Færdighedsbaseret Søgning** - Forespørg din projekthistorik med mem-search-færdighed
- 🖥️ **Web Viewer UI** - Realtids hukommelsesstream på http://localhost:37777
- 💻 **Claude Desktop-færdighed** - Søg i hukommelsen fra Claude Desktop-samtaler
- 🔒 **Privatkontrol** - Brug `<private>`-tags til at ekskludere følsomt indhold fra lagring
- ⚙️ **Kontekstkonfiguration** - Finjusteret kontrol over hvilken kontekst der indsprøjtes
- 🤖 **Automatisk Drift** - Ingen manuel indgriben påkrævet
- 🔗 **Citationer** - Henvisning til tidligere observationer med ID'er (tilgås via http://localhost:37777/api/observation/{id} eller se alle i web viewer på http://localhost:37777)
- 🧪 **Beta-kanal** - Prøv eksperimentelle funktioner som Endless Mode via versionsskift

---

## Dokumentation

📚 **[Se Fuld Dokumentation](https://github.com/ManuelStaggl/keepmind)** - Gennemse på den officielle hjemmeside

### Kom Godt I Gang

- **[Installationsguide](https://github.com/ManuelStaggl/keepmind)** - Hurtig start & avanceret installation
- **[Brugervejledning](https://github.com/ManuelStaggl/keepmind)** - Sådan fungerer keepmind automatisk
- **[Søgeværktøjer](https://github.com/ManuelStaggl/keepmind)** - Forespørg din projekthistorik med naturligt sprog
- **[Beta-funktioner](https://github.com/ManuelStaggl/keepmind)** - Prøv eksperimentelle funktioner som Endless Mode

### Bedste Praksis

- **[Kontekst-engineering](https://github.com/ManuelStaggl/keepmind)** - AI-agent kontekstoptimeringsprincipper
- **[Progressiv Afsløring](https://github.com/ManuelStaggl/keepmind)** - Filosofien bag keepminds kontekst-priming-strategi

### Arkitektur

- **[Oversigt](https://github.com/ManuelStaggl/keepmind)** - Systemkomponenter & dataflow
- **[Arkitekturudvikling](https://github.com/ManuelStaggl/keepmind)** - Rejsen fra v3 til v5
- **[Hooks-arkitektur](https://github.com/ManuelStaggl/keepmind)** - Hvordan keepmind bruger livscyklus-hooks
- **[Hooks-reference](https://github.com/ManuelStaggl/keepmind)** - 7 hook-scripts forklaret
- **[Worker Service](https://github.com/ManuelStaggl/keepmind)** - HTTP API & Bun-administration
- **[Database](https://github.com/ManuelStaggl/keepmind)** - SQLite-skema & FTS5-søgning
- **[Søgearkitektur](https://github.com/ManuelStaggl/keepmind)** - Hybrid søgning med Chroma vektordatabase

### Konfiguration & Udvikling

- **[Konfiguration](https://github.com/ManuelStaggl/keepmind)** - Miljøvariabler & indstillinger
- **[Udvikling](https://github.com/ManuelStaggl/keepmind)** - Bygning, testning, bidrag
- **[Fejlfinding](https://github.com/ManuelStaggl/keepmind)** - Almindelige problemer & løsninger

---

## Sådan Virker Det

**Kernekomponenter:**

1. **5 Livscyklus-hooks** - SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd (6 hook-scripts)
2. **Smart Installation** - Cached dependency checker (pre-hook script, ikke en livscyklus-hook)
3. **Worker Service** - HTTP API på port 37777 med web viewer UI og 10 søge-endpoints, administreret af Bun
4. **SQLite Database** - Gemmer sessioner, observationer, resuméer
5. **mem-search-færdighed** - Naturlige sprogforespørgsler med progressiv afsløring
6. **Chroma Vector Database** - Hybrid semantisk + søgeordssøgning for intelligent konteksthentning

Se [Arkitekturoversigt](https://github.com/ManuelStaggl/keepmind) for detaljer.

---

## mem-search-færdighed

keepmind leverer intelligent søgning gennem mem-search-færdigheden, der automatisk aktiveres, når du spørger om tidligere arbejde:

**Sådan Virker Det:**
- Spørg bare naturligt: *"Hvad lavede vi sidste session?"* eller *"Har vi løst denne fejl før?"*
- Claude aktiverer automatisk mem-search-færdigheden for at finde relevant kontekst

**Tilgængelige Søgeoperationer:**

1. **Search Observations** - Fuldtekstsøgning på tværs af observationer
2. **Search Sessions** - Fuldtekstsøgning på tværs af sessionsresumeer
3. **Search Prompts** - Søg i rå brugeranmodninger
4. **By Concept** - Find efter koncept-tags (discovery, problem-solution, pattern, osv.)
5. **By File** - Find observationer, der refererer til specifikke filer
6. **By Type** - Find efter type (decision, bugfix, feature, refactor, discovery, change)
7. **Recent Context** - Få nylig sessionskontekst for et projekt
8. **Timeline** - Få samlet tidslinje af kontekst omkring et specifikt tidspunkt
9. **Timeline by Query** - Søg efter observationer og få tidslinjekontekst omkring bedste match
10. **API Help** - Få søge-API-dokumentation

**Eksempler på Naturlige Sprogforespørgsler:**

```
"Hvilke fejl løste vi sidste session?"
"Hvordan implementerede vi autentificering?"
"Hvilke ændringer blev lavet i worker-service.ts?"
"Vis mig det seneste arbejde på dette projekt"
"Hvad skete der, da vi tilføjede viewer UI?"
```

Se [Søgeværktøjsguide](https://github.com/ManuelStaggl/keepmind) for detaljerede eksempler.

---

## Beta-funktioner

keepmind tilbyder en **beta-kanal** med eksperimentelle funktioner som **Endless Mode** (biomimetisk hukommelsesarkitektur til udvidede sessioner). Skift mellem stabile og beta-versioner fra web viewer UI på http://localhost:37777 → Settings.

Se **[Beta-funktionsdokumentation](https://github.com/ManuelStaggl/keepmind)** for detaljer om Endless Mode og hvordan du prøver det.

---

## Systemkrav

- **Node.js**: 20.0.0 eller højere
- **Claude Code**: Seneste version med plugin-support
- **Bun**: JavaScript runtime og procesmanager (auto-installeres, hvis manglende)
- **uv**: Python package manager til vektorsøgning (auto-installeres, hvis manglende)
- **SQLite 3**: Til vedvarende lagring (bundtet)

---

## Konfiguration

Indstillinger administreres i `~/.keepmind/settings.json` (auto-oprettet med standardindstillinger ved første kørsel). Konfigurer AI-model, worker-port, datakatalog, log-niveau og indstillinger for kontekstindsprøjtning.

Se **[Konfigurationsguide](https://github.com/ManuelStaggl/keepmind)** for alle tilgængelige indstillinger og eksempler.

---

## Udvikling

Se **[Udviklingsguide](https://github.com/ManuelStaggl/keepmind)** for bygningsinstruktioner, testning og bidragsworkflow.

---

## Fejlfinding

Hvis du oplever problemer, beskriv problemet til Claude, og troubleshoot-færdigheden vil automatisk diagnosticere og levere rettelser.

Se **[Fejlfindingsguide](https://github.com/ManuelStaggl/keepmind)** for almindelige problemer og løsninger.

---

## Fejlrapporter

Opret omfattende fejlrapporter med den automatiserede generator:

```bash
cd ~/.claude/plugins/marketplaces/thedotmack
npm run bug-report
```

## Bidrag

Bidrag er velkomne! Venligst:

1. Fork repositoriet
2. Opret en feature-branch
3. Lav dine ændringer med tests
4. Opdater dokumentation
5. Indsend en Pull Request

Se [Udviklingsguide](https://github.com/ManuelStaggl/keepmind) for bidragsworkflow.

---

## License

This project is licensed under the **Apache License 2.0** (Apache-2.0).

Copyright (C) 2025 Alex Newman (@thedotmack). All rights reserved.

See the [LICENSE](LICENSE) file for full details.

Apache-2.0 allows broad use, modification, distribution, and commercial use, subject to its terms.

**Ragtime note**: The ragtime/ directory is licensed under the **Apache License 2.0**. See [ragtime/LICENSE](ragtime/LICENSE) for details.

---


## Support

- **Dokumentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/ManuelStaggl/keepmind/issues)
- **Repository**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Forfatter**: Alex Newman ([@thedotmack](https://github.com/thedotmack))

---

**Bygget med Claude Agent SDK** | **Drevet af Claude Code** | **Lavet med TypeScript**