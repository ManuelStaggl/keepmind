import { describe, it, expect } from 'bun:test';
import { parseFile, isCoreLanguage } from '../src/services/smart-file-read/parser.js';

// These three languages were the top three by file count in the install that
// prompted the audit (C# 2058 files, XAML 297, PowerShell 270) and none of them
// had a grammar — smart-explore and learn-codebase could not read the codebase's
// primary language at all.

const CSHARP = `using System;
using System.Linq;

namespace Demo.App;

public interface IThing
{
    void Go();
}

public enum Color { Red, Green }

public record Point(int X, int Y);

public struct Vec { public int X; }

public class Widget : IThing
{
    public string Name { get; set; }

    public Widget(string name) { Name = name; }

    public void Go() { Console.WriteLine(Name); }
}
`;

const POWERSHELL = `function Get-Thing {
    param($Name)
    Write-Output $Name
}

class Machine {
    [string] $HostName
    [void] Start() { Write-Output "up" }
}

enum State { On; Off }
`;

const XAML = `<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="Main">
  <Grid>
    <Button Name="Ok" Content="OK" />
    <TextBlock Text="hi" />
  </Grid>
</Window>
`;

function names(symbols: ReturnType<typeof parseFile>['symbols']): string[] {
  const out: string[] = [];
  const walk = (list: typeof symbols) => {
    for (const s of list) {
      out.push(s.name);
      if (s.children) walk(s.children);
    }
  };
  walk(symbols);
  return out;
}

describe('C# grammar', () => {
  const parsed = parseFile(CSHARP, 'Widget.cs');

  it('detects the language from the extension', () => {
    expect(parsed.language).toBe('c_sharp');
  });

  it('finds classes, records, structs, interfaces and enums', () => {
    const found = names(parsed.symbols);
    expect(found).toContain('Widget');
    expect(found).toContain('Point');
    expect(found).toContain('Vec');
    expect(found).toContain('IThing');
    expect(found).toContain('Color');
  });

  it('nests methods and properties inside their class', () => {
    const widget = parsed.symbols.find(s => s.name === 'Widget');
    expect(widget).toBeDefined();
    const members = (widget!.children ?? []).map(c => c.name);
    expect(members).toContain('Go');
    expect(members).toContain('Name');
  });

  it('captures the property kind rather than folding it into methods', () => {
    const widget = parsed.symbols.find(s => s.name === 'Widget');
    const name = widget!.children!.find(c => c.name === 'Name');
    expect(name!.kind).toBe('property');
  });

  it('collects using directives as imports', () => {
    expect(parsed.imports.length).toBeGreaterThanOrEqual(2);
    expect(parsed.imports.join(' ')).toContain('System');
  });
});

describe('PowerShell grammar', () => {
  const parsed = parseFile(POWERSHELL, 'Deploy.ps1');

  it('detects the language from the extension', () => {
    expect(parsed.language).toBe('powershell');
  });

  it('finds functions, classes and enums', () => {
    const found = names(parsed.symbols);
    expect(found).toContain('Get-Thing');
    expect(found).toContain('Machine');
    expect(found).toContain('State');
  });

  it('nests class methods inside the class', () => {
    const machine = parsed.symbols.find(s => s.name === 'Machine');
    expect(machine).toBeDefined();
    expect((machine!.children ?? []).map(c => c.name)).toContain('Start');
  });

  it('also handles .psm1 modules', () => {
    expect(parseFile(POWERSHELL, 'Mod.psm1').language).toBe('powershell');
  });
});

describe('XML / XAML grammar', () => {
  const parsed = parseFile(XAML, 'MainWindow.xaml');

  it('maps XAML and project files onto the xml grammar', () => {
    expect(parsed.language).toBe('xml');
    expect(parseFile('<a/>', 'App.axaml').language).toBe('xml');
    expect(parseFile('<Project/>', 'Demo.csproj').language).toBe('xml');
  });

  it('renders the element tree', () => {
    const found = names(parsed.symbols);
    expect(found).toContain('Window');
    expect(found).toContain('Grid');
    expect(found).toContain('Button');
  });

  it('attaches each element to its innermost parent exactly once', () => {
    // Claiming from every enclosing container duplicated leaves at each level.
    const found = names(parsed.symbols);
    expect(found.filter(n => n === 'Button')).toHaveLength(1);
    expect(found.filter(n => n === 'TextBlock')).toHaveLength(1);

    const window = parsed.symbols.find(s => s.name === 'Window');
    expect((window!.children ?? []).map(c => c.name)).toEqual(['Grid']);
  });
});

describe('core vs on-demand grammar split', () => {
  it('ships the languages that appear in almost any project', () => {
    for (const lang of ['typescript', 'javascript', 'python', 'markdown', 'yaml', 'css', 'bash']) {
      expect(isCoreLanguage(lang)).toBe(true);
    }
  });

  it('ships the three that were missing', () => {
    expect(isCoreLanguage('c_sharp')).toBe(true);
    expect(isCoreLanguage('powershell')).toBe(true);
    expect(isCoreLanguage('xml')).toBe(true);
  });

  it('leaves the bulky, rarely-present grammars to on-demand fetch', () => {
    for (const lang of ['swift', 'scala', 'cpp', 'haskell', 'ruby', 'php', 'kotlin', 'elixir', 'zig']) {
      expect(isCoreLanguage(lang)).toBe(false);
    }
  });
});
