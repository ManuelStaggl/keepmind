🌐 Это автоматический перевод. Приветствуются исправления от сообщества!

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

<h4 align="center">Система сжатия постоянной памяти, созданная для <a href="https://claude.com/claude-code" target="_blank">Claude Code</a>.</h4>

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
  <a href="#быстрый-старт">Быстрый старт</a> •
  <a href="#как-это-работает">Как это работает</a> •
  <a href="#инструменты-поиска-mcp">Инструменты поиска</a> •
  <a href="#документация">Документация</a> •
  <a href="#конфигурация">Конфигурация</a> •
  <a href="#устранение-неполадок">Устранение неполадок</a> •
  <a href="#лицензия">Лицензия</a>
</p>

<p align="center">
  keepmind бесшовно сохраняет контекст между сеансами, автоматически фиксируя наблюдения за использованием инструментов, генерируя семантические сводки и делая их доступными для будущих сеансов. Это позволяет Claude поддерживать непрерывность знаний о проектах даже после завершения или переподключения сеансов.
</p>

---

## Быстрый старт

Запустите новый сеанс Claude Code в терминале и введите следующие команды:

```
> /plugin marketplace add ManuelStaggl/keepmind

> /plugin install keepmind
```

Перезапустите Claude Code. Контекст из предыдущих сеансов будет автоматически появляться в новых сеансах.

**Ключевые возможности:**

- 🧠 **Постоянная память** - Контекст сохраняется между сеансами
- 📊 **Прогрессивное раскрытие** - Многоуровневое извлечение памяти с видимостью стоимости токенов
- 🔍 **Поиск на основе навыков** - Запросы к истории проекта с помощью навыка mem-search
- 🖥️ **Веб-интерфейс просмотра** - Поток памяти в реальном времени на http://localhost:37777
- 💻 **Навык для Claude Desktop** - Поиск в памяти из разговоров Claude Desktop
- 🔒 **Контроль конфиденциальности** - Используйте теги `<private>` для исключения конфиденциального контента из хранилища
- ⚙️ **Настройка контекста** - Детальный контроль того, какой контекст внедряется
- 🤖 **Автоматическая работа** - Не требуется ручное вмешательство
- 🔗 **Цитирование** - Ссылки на прошлые наблюдения с помощью ID (доступ через http://localhost:37777/api/observation/{id} или просмотр всех в веб-интерфейсе на http://localhost:37777)
- 🧪 **Бета-канал** - Попробуйте экспериментальные функции, такие как режим Endless, переключая версии

---

## Документация

📚 **[Просмотреть полную документацию](https://github.com/ManuelStaggl/keepmind)** - Просмотр на официальном сайте

### Начало работы

- **[Руководство по установке](https://github.com/ManuelStaggl/keepmind)** - Быстрый старт и продвинутая установка
- **[Руководство по использованию](https://github.com/ManuelStaggl/keepmind)** - Как keepmind работает автоматически
- **[Инструменты поиска](https://github.com/ManuelStaggl/keepmind)** - Запросы к истории проекта на естественном языке
- **[Бета-функции](https://github.com/ManuelStaggl/keepmind)** - Попробуйте экспериментальные функции, такие как режим Endless

### Лучшие практики

- **[Инженерия контекста](https://github.com/ManuelStaggl/keepmind)** - Принципы оптимизации контекста для AI-агентов
- **[Прогрессивное раскрытие](https://github.com/ManuelStaggl/keepmind)** - Философия стратегии подготовки контекста в keepmind

### Архитектура

- **[Обзор](https://github.com/ManuelStaggl/keepmind)** - Компоненты системы и поток данных
- **[Эволюция архитектуры](https://github.com/ManuelStaggl/keepmind)** - Путь от v3 к v5
- **[Архитектура хуков](https://github.com/ManuelStaggl/keepmind)** - Как keepmind использует хуки жизненного цикла
- **[Справочник по хукам](https://github.com/ManuelStaggl/keepmind)** - Объяснение 7 скриптов хуков
- **[Сервис Worker](https://github.com/ManuelStaggl/keepmind)** - HTTP API и управление Bun
- **[База данных](https://github.com/ManuelStaggl/keepmind)** - Схема SQLite и поиск FTS5
- **[Архитектура поиска](https://github.com/ManuelStaggl/keepmind)** - Гибридный поиск с векторной базой данных Chroma

### Конфигурация и разработка

- **[Конфигурация](https://github.com/ManuelStaggl/keepmind)** - Переменные окружения и настройки
- **[Разработка](https://github.com/ManuelStaggl/keepmind)** - Сборка, тестирование, участие в разработке
- **[Устранение неполадок](https://github.com/ManuelStaggl/keepmind)** - Распространенные проблемы и решения

---

## Как это работает

**Основные компоненты:**

1. **5 хуков жизненного цикла** - SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd (6 скриптов хуков)
2. **Умная установка** - Проверка кешированных зависимостей (скрипт предварительного хука, не является хуком жизненного цикла)
3. **Сервис Worker** - HTTP API на порту 37777 с веб-интерфейсом просмотра и 10 конечными точками поиска, управляемый Bun
4. **База данных SQLite** - Хранит сеансы, наблюдения, сводки
5. **Навык mem-search** - Запросы на естественном языке с прогрессивным раскрытием
6. **Векторная база данных Chroma** - Гибридный семантический + ключевой поиск для интеллектуального извлечения контекста

Подробности см. в [Обзоре архитектуры](https://github.com/ManuelStaggl/keepmind).

---

## Навык mem-search

keepmind предоставляет интеллектуальный поиск через навык mem-search, который автоматически вызывается, когда вы спрашиваете о прошлой работе:

**Как это работает:**
- Просто спросите естественно: *"Что мы делали в прошлом сеансе?"* или *"Мы исправляли этот баг раньше?"*
- Claude автоматически вызывает навык mem-search для поиска релевантного контекста

**Доступные операции поиска:**

1. **Поиск наблюдений** - Полнотекстовый поиск по наблюдениям
2. **Поиск сеансов** - Полнотекстовый поиск по сводкам сеансов
3. **Поиск запросов** - Поиск исходных пользовательских запросов
4. **По концепции** - Поиск по тегам концепций (discovery, problem-solution, pattern и т.д.)
5. **По файлу** - Поиск наблюдений, ссылающихся на конкретные файлы
6. **По типу** - Поиск по типу (decision, bugfix, feature, refactor, discovery, change)
7. **Недавний контекст** - Получение недавнего контекста сеанса для проекта
8. **Хронология** - Получение единой хронологии контекста вокруг определенного момента времени
9. **Хронология по запросу** - Поиск наблюдений и получение контекста хронологии вокруг наилучшего совпадения
10. **Справка по API** - Получение документации по API поиска

**Примеры запросов на естественном языке:**

```
"Какие баги мы исправили в прошлом сеансе?"
"Как мы реализовали аутентификацию?"
"Какие изменения были внесены в worker-service.ts?"
"Покажи недавнюю работу над этим проектом"
"Что происходило, когда мы добавляли интерфейс просмотра?"
```

Подробные примеры см. в [Руководстве по инструментам поиска](https://github.com/ManuelStaggl/keepmind).

---

## Бета-функции

keepmind предлагает **бета-канал** с экспериментальными функциями, такими как **режим Endless** (биомиметическая архитектура памяти для расширенных сеансов). Переключайтесь между стабильной и бета-версиями из веб-интерфейса на http://localhost:37777 → Settings.

Подробности о режиме Endless и способах его опробовать см. в **[Документации по бета-функциям](https://github.com/ManuelStaggl/keepmind)**.

---

## Системные требования

- **Node.js**: 20.0.0 или выше
- **Claude Code**: Последняя версия с поддержкой плагинов
- **Bun**: Среда выполнения JavaScript и менеджер процессов (автоматически устанавливается при отсутствии)
- **uv**: Менеджер пакетов Python для векторного поиска (автоматически устанавливается при отсутствии)
- **SQLite 3**: Для постоянного хранения (встроенный)

---

## Конфигурация

Настройки управляются в `~/.keepmind/settings.json` (автоматически создается с настройками по умолчанию при первом запуске). Настройте AI-модель, порт worker, директорию данных, уровень логирования и параметры внедрения контекста.

Все доступные настройки и примеры см. в **[Руководстве по конфигурации](https://github.com/ManuelStaggl/keepmind)**.

---

## Разработка

Инструкции по сборке, тестированию и процессу участия в разработке см. в **[Руководстве по разработке](https://github.com/ManuelStaggl/keepmind)**.

---

## Устранение неполадок

При возникновении проблем опишите проблему Claude, и навык устранения неполадок автоматически выполнит диагностику и предоставит исправления.

Распространенные проблемы и решения см. в **[Руководстве по устранению неполадок](https://github.com/ManuelStaggl/keepmind)**.

---

## Отчеты об ошибках

Создавайте подробные отчеты об ошибках с помощью автоматического генератора:

```bash
cd ~/.claude/plugins/marketplaces/thedotmack
npm run bug-report
```

## Участие в разработке

Приветствуются вклады! Пожалуйста:

1. Форкните репозиторий
2. Создайте ветку для функции
3. Внесите изменения с тестами
4. Обновите документацию
5. Отправьте Pull Request

Процесс участия см. в [Руководстве по разработке](https://github.com/ManuelStaggl/keepmind).

---

## License

This project is licensed under the **Apache License 2.0** (Apache-2.0).

Copyright (C) 2025 Alex Newman (@thedotmack). All rights reserved.

See the [LICENSE](LICENSE) file for full details.

Apache-2.0 allows broad use, modification, distribution, and commercial use, subject to its terms.

**Ragtime note**: The ragtime/ directory is licensed under the **Apache License 2.0**. See [ragtime/LICENSE](ragtime/LICENSE) for details.

---


## Поддержка

- **Документация**: [docs/](docs/)
- **Проблемы**: [GitHub Issues](https://github.com/ManuelStaggl/keepmind/issues)
- **Репозиторий**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Автор**: Alex Newman ([@thedotmack](https://github.com/thedotmack))

---

**Создано с помощью Claude Agent SDK** | **Работает на Claude Code** | **Сделано на TypeScript**