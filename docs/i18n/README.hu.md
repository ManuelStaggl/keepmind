🌐 Ez egy automatikus fordítás. Közösségi javítások szívesen fogadottak!

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

<h4 align="center">Tartós memória tömörítési rendszer a <a href="https://claude.com/claude-code" target="_blank">Claude Code</a> számára.</h4>

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
  <a href="#gyors-kezdés">Gyors kezdés</a> •
  <a href="#hogyan-működik">Hogyan működik</a> •
  <a href="#keresési-eszközök">Keresési eszközök</a> •
  <a href="#dokumentáció">Dokumentáció</a> •
  <a href="#konfiguráció">Konfiguráció</a> •
  <a href="#hibaelhárítás">Hibaelhárítás</a> •
  <a href="#licenc">Licenc</a>
</p>

<p align="center">
  A keepmind zökkenőmentesen megőrzi a kontextust munkamenetek között azáltal, hogy automatikusan rögzíti az eszközhasználati megfigyeléseket, szemantikus összefoglalókat generál, és elérhetővé teszi azokat a jövőbeli munkamenetekben. Ez lehetővé teszi Claude számára, hogy fenntartsa a projektekkel kapcsolatos tudás folytonosságát még a munkamenetek befejezése vagy újracsatlakozása után is.
</p>

---

## Gyors kezdés

Indítson el egy új Claude Code munkamenetet a terminálban, és írja be a következő parancsokat:

```
> /plugin marketplace add ManuelStaggl/keepmind

> /plugin install keepmind
```

Indítsa újra a Claude Code-ot. A korábbi munkamenetek kontextusa automatikusan megjelenik az új munkamenetekben.

**Főbb jellemzők:**

- 🧠 **Tartós memória** - A kontextus túléli a munkameneteket
- 📊 **Progresszív felfedés** - Többrétegű memória-visszakeresés token költség láthatósággal
- 🔍 **Skill-alapú keresés** - Lekérdezheti projekt előzményeit a mem-search skill segítségével
- 🖥️ **Webes megjelenítő felület** - Valós idejű memória stream a http://localhost:37777 címen
- 💻 **Claude Desktop Skill** - Memória keresése Claude Desktop beszélgetésekből
- 🔒 **Adatvédelmi kontroll** - Használja a `<private>` címkéket az érzékeny tartalom kizárásához
- ⚙️ **Kontextus konfiguráció** - Finomhangolt kontroll afelett, hogy milyen kontextus kerül beillesztésre
- 🤖 **Automatikus működés** - Nincs szükség manuális beavatkozásra
- 🔗 **Hivatkozások** - Hivatkozás múltbeli megfigyelésekre ID-kkal (hozzáférés: http://localhost:37777/api/observation/{id} vagy mindegyik megtekintése a webes felületen a http://localhost:37777 címen)
- 🧪 **Béta csatorna** - Kísérleti funkciók, mint az Endless Mode kipróbálása verziócserével

---

## Dokumentáció

📚 **[Teljes dokumentáció megtekintése](https://github.com/ManuelStaggl/keepmind)** - Böngészés a hivatalos weboldalon

### Első lépések

- **[Telepítési útmutató](https://github.com/ManuelStaggl/keepmind)** - Gyors indítás és haladó telepítés
- **[Használati útmutató](https://github.com/ManuelStaggl/keepmind)** - Hogyan működik automatikusan a keepmind
- **[Keresési eszközök](https://github.com/ManuelStaggl/keepmind)** - Projekt előzmények lekérdezése természetes nyelvvel
- **[Béta funkciók](https://github.com/ManuelStaggl/keepmind)** - Kísérleti funkciók, mint az Endless Mode kipróbálása

### Bevált gyakorlatok

- **[Kontextus tervezés](https://github.com/ManuelStaggl/keepmind)** - AI ügynök kontextus optimalizálási elvek
- **[Progresszív felfedés](https://github.com/ManuelStaggl/keepmind)** - A keepmind kontextus előkészítési stratégiájának filozófiája

### Architektúra

- **[Áttekintés](https://github.com/ManuelStaggl/keepmind)** - Rendszerkomponensek és adatfolyam
- **[Architektúra fejlődés](https://github.com/ManuelStaggl/keepmind)** - Az út a v3-tól a v5-ig
- **[Hooks architektúra](https://github.com/ManuelStaggl/keepmind)** - Hogyan használja a keepmind az életciklus hookokat
- **[Hooks referencia](https://github.com/ManuelStaggl/keepmind)** - 7 hook szkript magyarázata
- **[Worker szolgáltatás](https://github.com/ManuelStaggl/keepmind)** - HTTP API és Bun kezelés
- **[Adatbázis](https://github.com/ManuelStaggl/keepmind)** - SQLite séma és FTS5 keresés
- **[Keresési architektúra](https://github.com/ManuelStaggl/keepmind)** - Hibrid keresés Chroma vektor adatbázissal

### Konfiguráció és fejlesztés

- **[Konfiguráció](https://github.com/ManuelStaggl/keepmind)** - Környezeti változók és beállítások
- **[Fejlesztés](https://github.com/ManuelStaggl/keepmind)** - Építés, tesztelés, hozzájárulás
- **[Hibaelhárítás](https://github.com/ManuelStaggl/keepmind)** - Gyakori problémák és megoldások

---

## Hogyan működik

**Fő komponensek:**

1. **5 életciklus hook** - SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd (6 hook szkript)
2. **Intelligens telepítés** - Gyorsítótárazott függőség ellenőrző (pre-hook szkript, nem életciklus hook)
3. **Worker szolgáltatás** - HTTP API a 37777-es porton webes megjelenítő felülettel és 10 keresési végponttal, Bun által kezelve
4. **SQLite adatbázis** - Munkamenetek, megfigyelések, összefoglalók tárolása
5. **mem-search Skill** - Természetes nyelvi lekérdezések progresszív felfedéssel
6. **Chroma vektor adatbázis** - Hibrid szemantikus + kulcsszó keresés intelligens kontextus visszakereséshez

További részletekért lásd az [Architektúra áttekintést](https://github.com/ManuelStaggl/keepmind).

---

## mem-search Skill

A keepmind intelligens keresést biztosít a mem-search skillen keresztül, amely automatikusan aktiválódik, amikor múltbeli munkáról kérdez:

**Hogyan működik:**
- Csak kérdezzen természetesen: *"Mit csináltunk az előző munkamenetben?"* vagy *"Javítottuk már ezt a hibát korábban?"*
- Claude automatikusan meghívja a mem-search skillet a releváns kontextus megtalálásához

**Elérhető keresési műveletek:**

1. **Megfigyelések keresése** - Teljes szöveges keresés a megfigyelésekben
2. **Munkamenetek keresése** - Teljes szöveges keresés munkamenet összefoglalókban
3. **Promptok keresése** - Nyers felhasználói kérések keresése
4. **Koncepció szerint** - Keresés koncepció címkék alapján (discovery, problem-solution, pattern, stb.)
5. **Fájl szerint** - Adott fájlokra hivatkozó megfigyelések keresése
6. **Típus szerint** - Keresés típus alapján (decision, bugfix, feature, refactor, discovery, change)
7. **Legutóbbi kontextus** - Legutóbbi munkamenet kontextus lekérése egy projekthez
8. **Idővonal** - Egységes idővonal kontextus lekérése egy adott időpont körül
9. **Idővonal lekérdezéssel** - Megfigyelések keresése és idővonal kontextus lekérése a legjobb találat körül
10. **API segítség** - Keresési API dokumentáció lekérése

**Példa természetes nyelvi lekérdezésekre:**

```
"Milyen hibákat javítottunk az előző munkamenetben?"
"Hogyan implementáltuk az autentikációt?"
"Milyen változtatások történtek a worker-service.ts fájlban?"
"Mutasd a legutóbbi munkát ezen a projekten"
"Mi történt, amikor hozzáadtuk a megjelenítő felületet?"
```

Részletes példákért lásd a [Keresési eszközök útmutatót](https://github.com/ManuelStaggl/keepmind).

---

## Béta funkciók

A keepmind **béta csatornát** kínál kísérleti funkciókkal, mint az **Endless Mode** (biomimetikus memória architektúra hosszabb munkamenetekhez). Váltson a stabil és béta verziók között a webes megjelenítő felületről a http://localhost:37777 → Settings címen.

További részletekért az Endless Mode-ról és annak kipróbálásáról lásd a **[Béta funkciók dokumentációt](https://github.com/ManuelStaggl/keepmind)**.

---

## Rendszerkövetelmények

- **Node.js**: 20.0.0 vagy újabb
- **Claude Code**: Legújabb verzió plugin támogatással
- **Bun**: JavaScript futtatókörnyezet és folyamatkezelő (automatikusan települ, ha hiányzik)
- **uv**: Python csomagkezelő vektor kereséshez (automatikusan települ, ha hiányzik)
- **SQLite 3**: Tartós tároláshoz (mellékelve)

---

## Konfiguráció

A beállítások a `~/.keepmind/settings.json` fájlban kezelhetők (automatikusan létrejön alapértelmezett értékekkel az első futtatáskor). Konfigurálható az AI modell, worker port, adatkönyvtár, naplózási szint és kontextus beillesztési beállítások.

Az összes elérhető beállításért és példákért lásd a **[Konfigurációs útmutatót](https://github.com/ManuelStaggl/keepmind)**.

---

## Fejlesztés

Az építési utasításokért, tesztelésért és hozzájárulási munkafolyamatért lásd a **[Fejlesztési útmutatót](https://github.com/ManuelStaggl/keepmind)**.

---

## Hibaelhárítás

Problémák esetén írja le a problémát Claude-nak, és a troubleshoot skill automatikusan diagnosztizálja és javítási megoldásokat kínál.

Gyakori problémákért és megoldásokért lásd a **[Hibaelhárítási útmutatót](https://github.com/ManuelStaggl/keepmind)**.

---

## Hibajelentések

Átfogó hibajelentések készítése az automatikus generátorral:

```bash
cd ~/.claude/plugins/marketplaces/thedotmack
npm run bug-report
```

## Hozzájárulás

A hozzájárulásokat szívesen fogadjuk! Kérjük:

1. Fork-olja a tárolót
2. Hozzon létre egy feature branchet
3. Végezze el változtatásait tesztekkel
4. Frissítse a dokumentációt
5. Nyújtson be egy Pull Requestet

A hozzájárulási munkafolyamatért lásd a [Fejlesztési útmutatót](https://github.com/ManuelStaggl/keepmind).

---

## License

This project is licensed under the **Apache License 2.0** (Apache-2.0).

Copyright (C) 2025 Alex Newman (@thedotmack). All rights reserved.

See the [LICENSE](LICENSE) file for full details.

Apache-2.0 allows broad use, modification, distribution, and commercial use, subject to its terms.

**Ragtime note**: The ragtime/ directory is licensed under the **Apache License 2.0**. See [ragtime/LICENSE](ragtime/LICENSE) for details.

---


## Támogatás

- **Dokumentáció**: [docs/](docs/)
- **Hibák**: [GitHub Issues](https://github.com/ManuelStaggl/keepmind/issues)
- **Tároló**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Szerző**: Alex Newman ([@thedotmack](https://github.com/thedotmack))

---

**Claude Agent SDK-val építve** | **Claude Code által hajtva** | **TypeScript-tel készítve**