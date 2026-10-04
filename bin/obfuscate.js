#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const { registry, moduleForFile, obfuscateSource } = require('../src/index');
const pkg = require('../package.json');

const isTermux = Boolean(
  process.env.TERMUX_VERSION ||
  (process.env.PREFIX && process.env.PREFIX.includes('com.termux'))
);

const PATH_LOG_FILE = path.join(path.resolve(__dirname, '..'), 'encoded-paths.txt');

const LANGUAGE_CHOICES = [
  { id: '1', name: 'Python', ext: '.py', aliases: ['python', 'py', '.py'] },
  { id: '2', name: 'JavaScript / Node.js', ext: '.js', aliases: ['javascript', 'js', 'node', 'nodejs', '.js', '.mjs', '.cjs'] },
  { id: '3', name: 'Bash / Shell', ext: '.sh', aliases: ['bash', 'sh', 'shell', '.sh', '.bash'] },
  { id: '4', name: 'C', ext: '.c', aliases: ['c', '.c', '.h'] },
  { id: '5', name: 'C++', ext: '.cpp', aliases: ['cpp', 'c++', 'cxx', '.cpp', '.cc', '.cxx', '.hpp'] },
  { id: '6', name: 'Java', ext: '.java', aliases: ['java', '.java'] },
  { id: '7', name: 'Rust', ext: '.rs', aliases: ['rust', 'rs', '.rs'] },
  { id: '8', name: 'Ruby', ext: '.rb', aliases: ['ruby', 'rb', '.rb'] },
  { id: '9', name: 'HTML', ext: '.html', aliases: ['html', 'htm', '.html', '.htm'] },
  { id: '10', name: 'CSS', ext: '.css', aliases: ['css', '.css'] },
];

function resolveLanguageChoice(input) {
  const norm = String(input || '').trim().toLowerCase();
  if (!norm) return null;
  for (const item of LANGUAGE_CHOICES) {
    if (item.id === norm || item.aliases.includes(norm) || item.name.toLowerCase() === norm) {
      return item;
    }
  }
  return null;
}

function normalizeUserPath(rawPath) {
  let cleaned = String(rawPath || '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.startsWith('~/') || cleaned === '~') {
    cleaned = path.join(os.homedir(), cleaned.slice(1));
  }
  return path.resolve(cleaned);
}

/**
 * Format output path as `<filename>-knoxenc.<extension>` in the same directory
 * (or inside `outdir` if provided).
 */
function buildKnoxOutputPath(inputFile, fallbackExt = '', outdir = null) {
  const resolved = path.resolve(inputFile);
  const ext = path.extname(resolved) || fallbackExt || '';
  const baseName = ext ? path.basename(resolved, ext) : path.basename(resolved);
  const cleanBase = baseName.endsWith('-knoxenc') ? baseName : `${baseName}-knoxenc`;
  const fileName = `${cleanBase}${ext}`;
  const targetDir = outdir ? path.resolve(outdir) : path.dirname(resolved);
  return path.join(targetDir, fileName);
}

/**
 * Persist the saved output path to `encoded-paths.txt` and return the log path.
 */
function recordSavedPath(savedFilePath, langName) {
  const absPath = path.resolve(savedFilePath);
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] [${langName}] ${absPath}\n`;
  try {
    fs.appendFileSync(PATH_LOG_FILE, entry, 'utf8');
  } catch (_) {
    // Ignore write errors if running from read-only mount
  }
  return PATH_LOG_FILE;
}

function createColors(enabled) {
  if (!enabled) {
    return {
      reset: '', bold: '', dim: '',
      cyan: '', green: '', yellow: '', red: '', magenta: '', blue: '', gray: '',
    };
  }
  return {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    gray: '\x1b[90m',
  };
}

function parseArgs(argv) {
  const args = {
    level: 'heavy',
    style: 'hex',
    passes: 1,
    seed: null,
    mba: true,
    recursive: false,
    exts: null,
    stdin: false,
    stdout: false,
    lang: null,
    stats: false,
    dryRun: false,
    interactive: false,
    doctor: false,
    quiet: false,
    color: !process.env.NO_COLOR && process.stdout.isTTY !== false,
    files: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '--outdir') args.outdir = argv[++i];
    else if (a === '-l' || a === '--level') args.level = (argv[++i] || 'heavy').toLowerCase();
    else if (a === '-s' || a === '--style' || a === '--ident-style') args.style = (argv[++i] || 'hex').toLowerCase();
    else if (a === '-p' || a === '--passes') args.passes = parseInt(argv[++i] || '1', 10);
    else if (a === '--seed') args.seed = argv[++i];
    else if (a === '--no-mba') args.mba = false;
    else if (a === '--mba') args.mba = true;
    else if (a === '-r' || a === '--recursive') args.recursive = true;
    else if (a === '--ext') {
      args.exts = (argv[++i] || '')
        .split(',')
        .map((e) => (e.trim().startsWith('.') ? e.trim().toLowerCase() : `.${e.trim().toLowerCase()}`))
        .filter((e) => e !== '.');
    } else if (a === '--stdin') args.stdin = true;
    else if (a === '--stdout') args.stdout = true;
    else if (a === '--lang') args.lang = argv[++i];
    else if (a === '--stats') args.stats = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '-i' || a === '--interactive') args.interactive = true;
    else if (a === '--doctor' || a === '--test') args.doctor = true;
    else if (a === '-q' || a === '--quiet') args.quiet = true;
    else if (a === '--no-color') args.color = false;
    else if (a === '-v' || a === '--version') args.version = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else args.files.push(a);
  }
  return args;
}

function printBanner(c) {
  const envTag = isTermux ? `${c.green}[Termux Edition]${c.reset}` : `${c.cyan}[CLI Edition]${c.reset}`;
  console.log(`${c.cyan}${c.bold}╭──────────────────────────────────────────────────────────╮${c.reset}`);
  console.log(`${c.cyan}${c.bold}│${c.reset}  ${c.magenta}${c.bold}KNOXENC / UOBF v${pkg.version}${c.reset} — Universal Source Encoder       ${c.cyan}${c.bold}│${c.reset}`);
  console.log(`${c.cyan}${c.bold}│${c.reset}  PNSC Stream Cipher • MBA Math • State-Machine Dispatch  ${c.cyan}${c.bold}│${c.reset}`);
  console.log(`${c.cyan}${c.bold}╰──────────────────────────────────────────────────────────╯${c.reset} ${envTag}`);
}

function printHelp(c) {
  printBanner(c);
  console.log(`
${c.bold}USAGE:${c.reset}
  ${c.green}node bin/obfuscate.js${c.reset}              Launch interactive Termux prompt
  ${c.green}knoxenc${c.reset}                            Launch interactive Termux prompt
  ${c.green}uobf${c.reset} <file|dir...> [options]       Direct CLI mode (saves as <filename>-knoxenc.<ext>)
  ${c.green}cat${c.reset} app.py | ${c.green}uobf${c.reset} --stdin --lang py > app-knoxenc.py

${c.bold}OBFUSCATION LEVELS (-l, --level):${c.reset}
  ${c.cyan}light${c.reset}      Polymorphic Nibble-Stream Cipher (PNSC) string encryption
  ${c.cyan}medium${c.reset}     + Mixed Boolean-Arithmetic (MBA) keys & opaque predicates
  ${c.cyan}heavy${c.reset}      + Shuffled string pools, state-machine flattening & renaming
  ${c.cyan}max${c.reset}        + Multi-stage dynamic bootstrapper & full numeric MBA

${c.bold}IDENTIFIER STYLES (-s, --style):${c.reset}
  ${c.yellow}hex${c.reset}        Hexadecimal prefixed (${c.gray}_0x4f8a1c${c.reset}) [default]
  ${c.yellow}homoglyph${c.reset}  Visual lookalikes (${c.gray}lI1O01lI1O${c.reset})
  ${c.yellow}underscore${c.reset} Dense underscore chains (${c.gray}__a_b__f_${c.reset})
  ${c.yellow}compact${c.reset}    Short minimal identifiers (${c.gray}_8f3a1${c.reset})

${c.bold}OPTIONS:${c.reset}
  -o, --out <path>       Custom output file path (defaults to <filename>-knoxenc.<ext>)
  --outdir <dir>         Output directory for batch / recursive inputs
  -l, --level <lvl>      light | medium | heavy | max (default: heavy)
  -s, --style <style>    hex | homoglyph | underscore | compact
  -p, --passes <1-5>     Multi-pass layering count (default: 1)
  --lang <lang>          Explicitly specify language (e.g. py, js, sh, c, cpp, java, rs, rb, html, css)
  --seed <str>           Deterministic PRNG seed for reproducible builds
  --no-mba               Disable Mixed Boolean-Arithmetic number encoding
  -r, --recursive        Recursively process directories
  --ext <e1,e2>          Filter extensions in recursive mode (e.g. py,js,sh)
  --stdin                Read source from stdin (requires --lang <ext>)
  --stdout               Write obfuscated code directly to stdout
  --stats                Show size & Shannon entropy analysis table
  --dry-run              Simulate obfuscation without writing files
  -i, --interactive      Launch interactive Termux prompt (default when no args given)
  --doctor, --test       Run Termux environment diagnostics & encoder self-test
  -q, --quiet            Minimal output (suppress banner and notes)
  --no-color             Disable ANSI color output
  -v, --version          Print version and environment details
  -h, --help             Show this help screen
`);
}

function collectInputFiles(inputs, { recursive = false, exts = null } = {}) {
  const results = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '.idea', '.vscode']);

  function walk(entry) {
    if (!fs.existsSync(entry)) {
      results.push({ path: entry, missing: true });
      return;
    }
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      const items = fs.readdirSync(entry);
      for (const item of items) {
        if (skipDirs.has(item)) continue;
        const full = path.join(entry, item);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          if (recursive) walk(full);
        } else {
          const ext = path.extname(item).toLowerCase();
          if (item.includes('.obf.') || item.includes('-knoxenc.')) continue;
          if (!registry[ext]) continue;
          if (exts && !exts.includes(ext)) continue;
          results.push({ path: full, missing: false });
        }
      }
    } else {
      results.push({ path: entry, missing: false });
    }
  }

  for (const inp of inputs) walk(inp);
  return results;
}

function runDoctor(c) {
  printBanner(c);
  console.log(`\n${c.bold}1. Environment & Toolchain Check:${c.reset}`);
  console.log(`   • Platform:    ${process.platform} (${process.arch})`);
  console.log(`   • Node.js:     ${process.version}`);
  console.log(`   • Termux Mode: ${isTermux ? `${c.green}Detected (${process.env.PREFIX || 'com.termux'})${c.reset}` : 'Standard POSIX/Linux'}`);

  const tools = ['node', 'python3', 'ruby', 'bash', 'gcc', 'g++', 'javac', 'rustc'];
  for (const t of tools) {
    try {
      const p = execSync(`which ${t}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      console.log(`   • ${t.padEnd(10)} ${c.green}✓${c.reset} ${c.gray}${p}${c.reset}`);
    } catch (_) {
      console.log(`   • ${t.padEnd(10)} ${c.yellow}○ (not installed)${c.reset}`);
    }
  }

  console.log(`\n${c.bold}2. Encoder Self-Test across All 10 Languages:${c.reset}`);
  const testCases = [
    { ext: '.c', name: 'C', src: '#include <stdio.h>\nint main(){printf("Hello %d\\n", 42);return 0;}' },
    { ext: '.cpp', name: 'C++', src: '#include <iostream>\nint main(){std::cout << "Hello" << std::endl;return 0;}' },
    { ext: '.java', name: 'Java', src: 'public class T { public static void main(String[] a){System.out.println("Hi");}}' },
    { ext: '.rs', name: 'Rust', src: 'fn main(){println!("Hello Rust!");}' },
    { ext: '.js', name: 'JavaScript', src: 'function f(x){const m = `Hi ${x}!`; return m;} console.log(f("JS"));' },
    { ext: '.py', name: 'Python', src: 'def f(x):\n    m = f"Hi {x}!"\n    return m\nprint(f("Py"))\n' },
    { ext: '.rb', name: 'Ruby', src: 'def f(x)\n  m = "Hi #{x}!"\n  puts m\nend\nf("Rb")\n' },
    { ext: '.sh', name: 'Bash', src: '#!/usr/bin/env bash\nmsg="Hello Termux"\necho "$msg"\n' },
    { ext: '.css', name: 'CSS', src: '.card { color: #ff0055; padding: 12px; }' },
    { ext: '.html', name: 'HTML', src: '<html><style>.box{color:red}</style><body><div class="box">Hello</div><script>console.log("ok");</script></body></html>' },
  ];

  let passed = 0;
  for (const tc of testCases) {
    try {
      const res = obfuscateSource(tc.src, tc.ext, { level: 'heavy', style: 'homoglyph' });
      if (res.code && res.code.length > 10) {
        passed++;
        console.log(
          `   ${c.green}✓${c.reset} ${tc.name.padEnd(12)} ${c.gray}${res.stats.originalBytes}B -> ${res.stats.obfuscatedBytes}B (entropy: ${res.stats.obfuscatedEntropy} b/B)${c.reset}`
        );
      }
    } catch (e) {
      console.log(`   ${c.red}✗${c.reset} ${tc.name.padEnd(12)} ${e.message}`);
    }
  }
  console.log(`\n${c.green}${c.bold}Self-test complete: ${passed}/${testCases.length} language encoders verified.${c.reset}`);
}

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  const lineQueue = [];
  const waiters = [];
  let closed = false;

  rl.on('line', (line) => {
    if (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve(line.trim());
    } else {
      lineQueue.push(line.trim());
    }
  });

  rl.on('close', () => {
    closed = true;
    while (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve(null);
    }
  });

  return {
    ask(questionText) {
      process.stdout.write(questionText);
      if (lineQueue.length > 0) {
        const next = lineQueue.shift();
        if (!process.stdin.isTTY) process.stdout.write(next + '\n');
        return Promise.resolve(next);
      }
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      rl.close();
    },
  };
}

/**
 * Interactive Termux Flow:
 * 1. Ask which language the user needs to encode.
 * 2. Ask for the path of the file.
 * 3. Encode the file and save as `<filename>-knoxenc.<extension>`.
 * 4. Save the path to `encoded-paths.txt` and print the full saved path.
 */
async function runInteractive(c, args = {}) {
  printBanner(c);
  const prompt = createPrompt();

  try {
    console.log(`\n${c.bold}${c.yellow}Select Language to Encode:${c.reset}`);
    for (const item of LANGUAGE_CHOICES) {
      console.log(
        `  ${c.cyan}[${item.id.padStart(2, ' ')}]${c.reset} ${c.bold}${item.name.padEnd(20)}${c.reset} ${c.gray}(${item.ext})${c.reset}`
      );
    }
    console.log('');

    let selectedLang = null;
    while (!selectedLang) {
      const langAns = await prompt.ask(
        `${c.cyan}?${c.reset} ${c.bold}Which language do you need to encode? (1-10 or name): ${c.reset}`
      );
      if (langAns === null) {
        prompt.close();
        process.exit(1);
      }
      if (!langAns) {
        console.log(`${c.red}  Please enter a language number (1-10) or name (e.g. python, js, bash).${c.reset}`);
        continue;
      }
      selectedLang = resolveLanguageChoice(langAns);
      if (!selectedLang) {
        console.log(`${c.red}  ✗ Unknown language "${langAns}". Choose 1-10 or py/js/sh/c/cpp/java/rs/rb/html/css.${c.reset}`);
      }
    }

    console.log(`  ${c.green}✓ Selected Language:${c.reset} ${c.bold}${selectedLang.name}${c.reset} (${selectedLang.ext})\n`);

    let targetFile = null;
    while (!targetFile) {
      const rawFileAns = await prompt.ask(
        `${c.cyan}?${c.reset} ${c.bold}Enter the path of the file to encode: ${c.reset}`
      );
      if (rawFileAns === null) {
        prompt.close();
        process.exit(1);
      }
      if (!rawFileAns) {
        console.log(`${c.red}  Please enter a valid file path.${c.reset}`);
        continue;
      }
      const resolved = normalizeUserPath(rawFileAns);
      if (!fs.existsSync(resolved)) {
        console.log(`${c.red}  ✗ File not found at: ${resolved}${c.reset}`);
        continue;
      }
      if (fs.statSync(resolved).isDirectory()) {
        console.log(`${c.red}  ✗ "${resolved}" is a directory. Please provide a file path.${c.reset}`);
        continue;
      }
      targetFile = resolved;
    }

    prompt.close();

    const src = fs.readFileSync(targetFile, 'utf8');
    const level = args.level || 'heavy';
    const style = args.style || 'hex';
    const passes = args.passes || 1;

    const { code, notes, mapping, stats } = obfuscateSource(src, selectedLang.ext, {
      level,
      passes,
      style,
      seed: args.seed,
      mba: args.mba !== false,
    });

    const outPath = args.out
      ? normalizeUserPath(args.out)
      : buildKnoxOutputPath(targetFile, selectedLang.ext, args.outdir);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, code, 'utf8');

    const logFilePath = recordSavedPath(outPath, selectedLang.name);

    let mapPath = null;
    if (mapping && Object.keys(mapping).length) {
      mapPath = outPath + '.map.json';
      fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2), 'utf8');
    }

    console.log(`\n${c.green}${c.bold}╭──────────────────────────────────────────────────────────╮${c.reset}`);
    console.log(`${c.green}${c.bold}│  ✓ FILE ENCODED SUCCESSFULLY                             │${c.reset}`);
    console.log(`${c.green}${c.bold}╰──────────────────────────────────────────────────────────╯${c.reset}`);
    console.log(`  ${c.bold}Language     :${c.reset} ${c.magenta}${selectedLang.name}${c.reset} (${selectedLang.ext})`);
    console.log(`  ${c.bold}Input Path   :${c.reset} ${targetFile}`);
    console.log(`  ${c.bold}Output File  :${c.reset} ${c.green}${c.bold}${path.basename(outPath)}${c.reset}`);
    console.log(`  ${c.bold}Saved Path   :${c.reset} ${c.cyan}${c.bold}${outPath}${c.reset}`);
    console.log(`  ${c.bold}Path Saved In:${c.reset} ${c.gray}${logFilePath}${c.reset}`);
    console.log(
      `  ${c.bold}Size & Stats :${c.reset} ${stats.originalBytes}B -> ${stats.obfuscatedBytes}B (${stats.ratio}x) | Entropy: ${stats.originalEntropy} -> ${stats.obfuscatedEntropy} bits/byte`
    );
    if (mapPath) {
      console.log(`  ${c.bold}Selector Map :${c.reset} ${c.gray}${mapPath}${c.reset}`);
    }
    if (notes && notes.length) {
      console.log(`\n  ${c.bold}Applied Layers:${c.reset}`);
      for (const n of notes) {
        console.log(`   ${c.gray}• ${n}${c.reset}`);
      }
    }
    console.log('');
  } catch (err) {
    prompt.close();
    console.error(`${c.red}✗ ${err.message}${c.reset}`);
    process.exit(1);
  }
}

function processFiles(args, c) {
  const validLevels = new Set(['light', 'medium', 'heavy', 'max']);
  if (!validLevels.has(args.level)) {
    console.error(`${c.red}✗ Invalid level "${args.level}". Choose: light | medium | heavy | max${c.reset}`);
    process.exit(1);
  }

  const targets = collectInputFiles(args.files, {
    recursive: args.recursive,
    exts: args.exts,
  });

  if (targets.length === 0) {
    console.error(`${c.yellow}No matching source files found to obfuscate.${c.reset}`);
    process.exit(1);
  }

  if (!args.quiet && !args.stdout) {
    printBanner(c);
  }

  const summary = [];
  const explicitLangChoice = args.lang ? resolveLanguageChoice(args.lang) : null;

  for (const item of targets) {
    const file = normalizeUserPath(item.path);
    if (item.missing || !fs.existsSync(file)) {
      console.error(`${c.red}✗ ${item.path}: not found${c.reset}`);
      continue;
    }

    const targetExtOrFile = explicitLangChoice ? explicitLangChoice.ext : file;
    try {
      moduleForFile(targetExtOrFile);
    } catch (e) {
      console.error(`${c.red}✗ ${file}: ${e.message}${c.reset}`);
      continue;
    }

    const src = fs.readFileSync(file, 'utf8');
    const { code, notes, mapping, stats } = obfuscateSource(src, targetExtOrFile, {
      level: args.level,
      passes: args.passes,
      style: args.style,
      seed: args.seed,
      mba: args.mba,
    });

    if (args.stdout) {
      process.stdout.write(code);
      continue;
    }

    const outPath = args.out && targets.length === 1
      ? normalizeUserPath(args.out)
      : buildKnoxOutputPath(file, explicitLangChoice ? explicitLangChoice.ext : '', args.outdir);

    let logFilePath = PATH_LOG_FILE;
    if (!args.dryRun) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, code, 'utf8');
      logFilePath = recordSavedPath(
        outPath,
        explicitLangChoice ? explicitLangChoice.name : path.extname(file)
      );
    }

    console.log(
      `${c.green}✓${c.reset} ${c.bold}${file}${c.reset} -> ${c.cyan}${c.bold}${outPath}${c.reset}${args.dryRun ? ` ${c.yellow}(dry-run)${c.reset}` : ''}`
    );
    console.log(`   ${c.bold}Saved Path:${c.reset} ${c.cyan}${outPath}${c.reset}`);
    if (!args.dryRun && !args.quiet) {
      console.log(`   ${c.gray}• Path recorded in: ${logFilePath}${c.reset}`);
    }

    if (!args.quiet && notes && notes.length) {
      for (const n of notes) console.log(`   ${c.gray}• ${n}${c.reset}`);
    }

    if (!args.dryRun && mapping && Object.keys(mapping).length) {
      const mapPath = outPath + '.map.json';
      fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2), 'utf8');
      if (!args.quiet) {
        console.log(`   ${c.gray}• selector rename map -> ${mapPath}${c.reset}`);
      }
    }

    summary.push({ file: path.basename(file), outPath, stats });
  }

  if (args.stats && summary.length > 0 && !args.stdout) {
    console.log(`\n${c.bold}Obfuscation Telemetry:${c.reset}`);
    console.log(`${c.gray}────────────────────────────────────────────────────────────────────${c.reset}`);
    console.log(
      `${c.bold}${'File'.padEnd(18)} ${'Level'.padEnd(8)} ${'Style'.padEnd(11)} ${'Size (B)'.padEnd(16)} ${'Entropy (b/B)'}${c.reset}`
    );
    console.log(`${c.gray}────────────────────────────────────────────────────────────────────${c.reset}`);
    for (const row of summary) {
      const s = row.stats;
      const sizeStr = `${s.originalBytes}->${s.obfuscatedBytes} (${s.ratio}x)`;
      const entStr = `${s.originalEntropy} -> ${s.obfuscatedEntropy}`;
      console.log(
        `${row.file.slice(0, 17).padEnd(18)} ${s.level.padEnd(8)} ${s.style.padEnd(11)} ${sizeStr.padEnd(16)} ${c.cyan}${entStr}${c.reset}`
      );
    }
    console.log(`${c.gray}────────────────────────────────────────────────────────────────────${c.reset}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const c = createColors(args.color);

  if (args.version) {
    console.log(`knoxenc / uobf v${pkg.version} (${isTermux ? 'Termux' : process.platform}/${process.arch}, Node ${process.version})`);
    process.exit(0);
  }

  if (args.help) {
    printHelp(c);
    process.exit(0);
  }

  if (args.doctor) {
    runDoctor(c);
    process.exit(0);
  }

  if (args.stdin) {
    if (!args.lang) {
      console.error(`${c.red}✗ --stdin requires --lang <ext> (e.g. --lang py or --lang js)${c.reset}`);
      process.exit(1);
    }
    const langChoice = resolveLanguageChoice(args.lang);
    const ext = langChoice ? langChoice.ext : args.lang;
    const src = fs.readFileSync(0, 'utf8');
    const { code } = obfuscateSource(src, ext, {
      level: args.level,
      passes: args.passes,
      style: args.style,
      seed: args.seed,
      mba: args.mba,
    });
    if (args.out) {
      const outPath = normalizeUserPath(args.out);
      fs.writeFileSync(outPath, code, 'utf8');
      recordSavedPath(outPath, langChoice ? langChoice.name : ext);
      console.error(`Saved Path: ${outPath}`);
    } else {
      process.stdout.write(code);
    }
    return;
  }

  // Launch interactive Termux language + file path prompt when invoked with no files or with -i
  if (args.interactive || args.files.length === 0) {
    runInteractive(c, args);
    return;
  }

  processFiles(args, c);
}

main();
