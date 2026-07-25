🌐 To jest automatyczne tłumaczenie. Korekty społeczności są mile widziane!

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

<h4 align="center">System trwałej kompresji pamięci stworzony dla <a href="https://claude.com/claude-code" target="_blank">Claude Code</a>.</h4>

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
  <a href="#szybki-start">Szybki Start</a> •
  <a href="#jak-to-działa">Jak To Działa</a> •
  <a href="#narzędzia-wyszukiwania">Narzędzia Wyszukiwania</a> •
  <a href="#dokumentacja">Dokumentacja</a> •
  <a href="#konfiguracja">Konfiguracja</a> •
  <a href="#rozwiązywanie-problemów">Rozwiązywanie Problemów</a> •
  <a href="#licencja">Licencja</a>
</p>

<p align="center">
  keepmind płynnie zachowuje kontekst między sesjami, automatycznie przechwytując obserwacje użycia narzędzi, generując semantyczne podsumowania i udostępniając je przyszłym sesjom. To umożliwia Claude utrzymanie ciągłości wiedzy o projektach nawet po zakończeniu lub ponownym połączeniu sesji.
</p>

---

## Szybki Start

Uruchom nową sesję Claude Code w terminalu i wprowadź następujące polecenia:

```
> /plugin marketplace add ManuelStaggl/keepmind

> /plugin install keepmind
```

Uruchom ponownie Claude Code. Kontekst z poprzednich sesji automatycznie pojawi się w nowych sesjach.

**Kluczowe Funkcje:**

- 🧠 **Trwała Pamięć** - Kontekst przetrwa między sesjami
- 📊 **Stopniowe Ujawnianie** - Warstwowe pobieranie pamięci z widocznością kosztów tokenów
- 🔍 **Wyszukiwanie Oparte na Umiejętnościach** - Przeszukuj historię projektu za pomocą umiejętności mem-search
- 🖥️ **Interfejs Przeglądarki Internetowej** - Strumień pamięci w czasie rzeczywistym pod adresem http://localhost:37777
- 💻 **Umiejętność Claude Desktop** - Przeszukuj pamięć z konwersacji Claude Desktop
- 🔒 **Kontrola Prywatności** - Użyj tagów `<private>`, aby wykluczyć wrażliwe treści z przechowywania
- ⚙️ **Konfiguracja Kontekstu** - Szczegółowa kontrola nad tym, jaki kontekst jest wstrzykiwany
- 🤖 **Automatyczne Działanie** - Nie wymaga ręcznej interwencji
- 🔗 **Cytowania** - Odniesienia do przeszłych obserwacji za pomocą identyfikatorów (dostęp przez http://localhost:37777/api/observation/{id} lub wyświetl wszystkie w przeglądarce internetowej pod adresem http://localhost:37777)
- 🧪 **Kanał Beta** - Wypróbuj eksperymentalne funkcje, takie jak Endless Mode, poprzez przełączanie wersji

---

## Dokumentacja

📚 **[Wyświetl Pełną Dokumentację](https://github.com/ManuelStaggl/keepmind)** - Przeglądaj na oficjalnej stronie

### Pierwsze Kroki

- **[Przewodnik Instalacji](https://github.com/ManuelStaggl/keepmind)** - Szybki start i zaawansowana instalacja
- **[Przewodnik Użytkowania](https://github.com/ManuelStaggl/keepmind)** - Jak keepmind działa automatycznie
- **[Narzędzia Wyszukiwania](https://github.com/ManuelStaggl/keepmind)** - Przeszukuj historię projektu w języku naturalnym
- **[Funkcje Beta](https://github.com/ManuelStaggl/keepmind)** - Wypróbuj eksperymentalne funkcje, takie jak Endless Mode

### Najlepsze Praktyki

- **[Inżynieria Kontekstu](https://github.com/ManuelStaggl/keepmind)** - Zasady optymalizacji kontekstu agenta AI
- **[Stopniowe Ujawnianie](https://github.com/ManuelStaggl/keepmind)** - Filozofia strategii przygotowania kontekstu keepmind

### Architektura

- **[Przegląd](https://github.com/ManuelStaggl/keepmind)** - Komponenty systemu i przepływ danych
- **[Ewolucja Architektury](https://github.com/ManuelStaggl/keepmind)** - Droga od v3 do v5
- **[Architektura Hooków](https://github.com/ManuelStaggl/keepmind)** - Jak keepmind wykorzystuje hooki cyklu życia
- **[Dokumentacja Hooków](https://github.com/ManuelStaggl/keepmind)** - 7 skryptów hooków wyjaśnionych
- **[Usługa Worker](https://github.com/ManuelStaggl/keepmind)** - HTTP API i zarządzanie Bun
- **[Baza Danych](https://github.com/ManuelStaggl/keepmind)** - Schemat SQLite i wyszukiwanie FTS5
- **[Architektura Wyszukiwania](https://github.com/ManuelStaggl/keepmind)** - Hybrydowe wyszukiwanie z bazą wektorów Chroma

### Konfiguracja i Rozwój

- **[Konfiguracja](https://github.com/ManuelStaggl/keepmind)** - Zmienne środowiskowe i ustawienia
- **[Rozwój](https://github.com/ManuelStaggl/keepmind)** - Budowanie, testowanie, współpraca
- **[Rozwiązywanie Problemów](https://github.com/ManuelStaggl/keepmind)** - Typowe problemy i rozwiązania

---

## Jak To Działa

**Główne Komponenty:**

1. **5 Hooków Cyklu Życia** - SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd (6 skryptów hooków)
2. **Inteligentna Instalacja** - Buforowany sprawdzacz zależności (skrypt pre-hook, nie hook cyklu życia)
3. **Usługa Worker** - HTTP API na porcie 37777 z interfejsem przeglądarki internetowej i 10 punktami końcowymi wyszukiwania, zarządzana przez Bun
4. **Baza Danych SQLite** - Przechowuje sesje, obserwacje, podsumowania
5. **Umiejętność mem-search** - Zapytania w języku naturalnym ze stopniowym ujawnianiem
6. **Baza Wektorów Chroma** - Hybrydowe wyszukiwanie semantyczne + słowa kluczowe dla inteligentnego pobierania kontekstu

Zobacz [Przegląd Architektury](https://github.com/ManuelStaggl/keepmind) dla szczegółów.

---

## Umiejętność mem-search

keepmind zapewnia inteligentne wyszukiwanie poprzez umiejętność mem-search, która automatycznie aktywuje się, gdy pytasz o przeszłą pracę:

**Jak To Działa:**
- Po prostu pytaj naturalnie: *"Co robiliśmy w ostatniej sesji?"* lub *"Czy naprawiliśmy ten błąd wcześniej?"*
- Claude automatycznie wywołuje umiejętność mem-search, aby znaleźć odpowiedni kontekst

**Dostępne Operacje Wyszukiwania:**

1. **Search Observations** - Wyszukiwanie pełnotekstowe w obserwacjach
2. **Search Sessions** - Wyszukiwanie pełnotekstowe w podsumowaniach sesji
3. **Search Prompts** - Wyszukiwanie surowych żądań użytkownika
4. **By Concept** - Znajdź według tagów koncepcyjnych (discovery, problem-solution, pattern, itp.)
5. **By File** - Znajdź obserwacje odnoszące się do określonych plików
6. **By Type** - Znajdź według typu (decision, bugfix, feature, refactor, discovery, change)
7. **Recent Context** - Pobierz ostatni kontekst sesji dla projektu
8. **Timeline** - Uzyskaj ujednoliconą oś czasu kontekstu wokół określonego punktu w czasie
9. **Timeline by Query** - Wyszukaj obserwacje i uzyskaj kontekst osi czasu wokół najlepszego dopasowania
10. **API Help** - Uzyskaj dokumentację API wyszukiwania

**Przykładowe Zapytania w Języku Naturalnym:**

```
"What bugs did we fix last session?"
"How did we implement authentication?"
"What changes were made to worker-service.ts?"
"Show me recent work on this project"
"What was happening when we added the viewer UI?"
```

Zobacz [Przewodnik Narzędzi Wyszukiwania](https://github.com/ManuelStaggl/keepmind) dla szczegółowych przykładów.

---

## Funkcje Beta

keepmind oferuje **kanał beta** z eksperymentalnymi funkcjami, takimi jak **Endless Mode** (biomimetyczna architektura pamięci dla rozszerzonych sesji). Przełączaj się między stabilnymi a beta wersjami z interfejsu przeglądarki internetowej pod adresem http://localhost:37777 → Settings.

Zobacz **[Dokumentacja Funkcji Beta](https://github.com/ManuelStaggl/keepmind)** dla szczegółów dotyczących Endless Mode i sposobu wypróbowania.

---

## Wymagania Systemowe

- **Node.js**: 20.0.0 lub wyższy
- **Claude Code**: Najnowsza wersja z obsługą wtyczek
- **Bun**: Środowisko uruchomieniowe JavaScript i menedżer procesów (automatycznie instalowany, jeśli brakuje)
- **uv**: Menedżer pakietów Python do wyszukiwania wektorowego (automatycznie instalowany, jeśli brakuje)
- **SQLite 3**: Do trwałego przechowywania (dołączony)

---

## Konfiguracja

Ustawienia są zarządzane w `~/.keepmind/settings.json` (automatycznie tworzone z domyślnymi wartościami przy pierwszym uruchomieniu). Skonfiguruj model AI, port workera, katalog danych, poziom logowania i ustawienia wstrzykiwania kontekstu.

Zobacz **[Przewodnik Konfiguracji](https://github.com/ManuelStaggl/keepmind)** dla wszystkich dostępnych ustawień i przykładów.

---

## Rozwój

Zobacz **[Przewodnik Rozwoju](https://github.com/ManuelStaggl/keepmind)** dla instrukcji budowania, testowania i przepływu pracy współpracy.

---

## Rozwiązywanie Problemów

Jeśli napotkasz problemy, opisz problem Claude, a umiejętność troubleshoot automatycznie zdiagnozuje i dostarczy poprawki.

Zobacz **[Przewodnik Rozwiązywania Problemów](https://github.com/ManuelStaggl/keepmind)** dla typowych problemów i rozwiązań.

---

## Zgłoszenia Błędów

Twórz kompleksowe raporty błędów za pomocą automatycznego generatora:

```bash
cd ~/.claude/plugins/marketplaces/thedotmack
npm run bug-report
```

## Współpraca

Wkład jest mile widziany! Proszę:

1. Forkuj repozytorium
2. Utwórz gałąź funkcji
3. Dokonaj zmian z testami
4. Zaktualizuj dokumentację
5. Prześlij Pull Request

Zobacz [Przewodnik Rozwoju](https://github.com/ManuelStaggl/keepmind) dla przepływu pracy współpracy.

---

## License

This project is licensed under the **Apache License 2.0** (Apache-2.0).

Copyright (C) 2025 Alex Newman (@thedotmack). All rights reserved.

See the [LICENSE](LICENSE) file for full details.

Apache-2.0 allows broad use, modification, distribution, and commercial use, subject to its terms.

**Ragtime note**: The ragtime/ directory is licensed under the **Apache License 2.0**. See [ragtime/LICENSE](ragtime/LICENSE) for details.

---


## Wsparcie

- **Dokumentacja**: [docs/](docs/)
- **Problemy**: [GitHub Issues](https://github.com/ManuelStaggl/keepmind/issues)
- **Repozytorium**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Autor**: Alex Newman ([@thedotmack](https://github.com/thedotmack))

---

**Zbudowano za pomocą Claude Agent SDK** | **Zasilane przez Claude Code** | **Wykonane w TypeScript**