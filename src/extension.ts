
import * as vscode from 'vscode';

// Regexes for normalization
const HEADING_RE = /^\s{0,3}#/;
const PLACEHOLDER_RE = /\{[{]?[A-Za-z0-9_:-]+[}]?}/g;
const EMPHASIS_RE = /(\*\*|__|`)/g;
const LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;

function normalize(line: string): string {
    return line
        .replace(LINK_RE, '$1')
        .replace(EMPHASIS_RE, '')
        .replace(PLACEHOLDER_RE, '<VAR>');
}

function shannon(s: string): number {
    if (!s) return 0.0;
    const counts: Record<string, number> = {};
    for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
    const n = s.length;
    let entropy = 0;
    for (const c in counts) {
        const p = counts[c] / n;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

function caseSwitchRate(line: string): number {
    let switches = 0;
    let lastIsUpper: boolean | undefined = undefined;
    let alpha = 0;
    for (const ch of line) {
        if (/[a-zA-Z]/.test(ch)) {
            const cur = ch === ch.toUpperCase();
            if (lastIsUpper !== undefined && cur !== lastIsUpper) switches++;
            lastIsUpper = cur;
            alpha++;
        }
    }
    return alpha ? switches / alpha : 0.0;
}

interface LineData {
    raw: string;
    norm: string;
    entropy: number;
    avgTokenLen: number;
    uniqRatio: number;
    symbolDensity: number;
    caseSwitch: number;
    compressionRatio: number;
    mdlBitsPerChar: number;
    stepCount: number;
    periodicityBias: boolean;
    issues: string[];
    severity?: 'INFO' | 'WARN' | 'HIGH';
    score: number;
}

function simpleCompressLen(s: string): number {
    // Simple RLE as a proxy for compression (not real gzip, but fast and deterministic)
    if (!s) return 0;
    let last = s[0], count = 1, out = '';
    for (let i = 1; i < s.length; ++i) {
        if (s[i] === last) count++;
        else {
            out += last + (count > 1 ? count : '');
            last = s[i]; count = 1;
        }
    }
    out += last + (count > 1 ? count : '');
    return out.length;
}

function countSteps(line: string): number {
    // Count explicit reasoning steps (e.g., "Step 1:", "Step 2:", "First, Second, Third")
    const stepRegex = /(step\s*\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)/gi;
    return (line.match(stepRegex) || []).length;
}

function computeMetrics(lines: string[]): LineData[] {
    const data: LineData[] = lines.map((raw, idx) => {
        const norm = normalize(raw);
        const tokens = norm.match(/\w+/g) || [];
        const tokenLens = tokens.map(t => t.length);
        const uniq = new Set(tokens);
        const entropy = shannon(norm);
        const avgTokenLen = tokenLens.length ? tokenLens.reduce((a,b)=>a+b,0)/tokenLens.length : 0;
        const symbolDensity = norm.length ? (norm.replace(/\w|\s/g,'').length / norm.length) : 0;
        const caseSwitch = caseSwitchRate(norm);
        // Kolmogorov complexity proxy: compression ratio
        const compressedLen = simpleCompressLen(norm);
        const compressionRatio = norm.length ? compressedLen / norm.length : 0;
        // MDL proxy: bits per char (using entropy)
        const mdlBitsPerChar = entropy;
        // Chain-of-thought step count
        const stepCount = countSteps(norm);
        // Periodicity/positional bias: every 64th line
        const periodicityBias = ((idx+1) % 64 === 0);
        return {
            raw, norm, entropy, avgTokenLen,
            uniqRatio: tokens.length ? uniq.size / tokens.length : 0,
            symbolDensity, caseSwitch,
            compressionRatio, mdlBitsPerChar, stepCount, periodicityBias,
            issues: [], score: 0
        };
    });

    // Baseline-based flagging: compute per-metric mean/stdev, flag outliers

    // Helper: quantile
    function quantile(arr: number[], q: number) {
        if (!arr.length) return 0;
        const sorted = [...arr].sort((a,b)=>a-b);
        const pos = Math.floor((1-q)*sorted.length);
        return sorted[pos];
    }

    // Gather arrays for each metric
    const entropies = data.map(d=>d.entropy);
    const avgTokenLens = data.map(d=>d.avgTokenLen);
    const symbolDensities = data.map(d=>d.symbolDensity);
    const compressionRatios = data.map(d=>d.compressionRatio);
    const mdlBits = data.map(d=>d.mdlBitsPerChar);

    // Use static thresholds for each metric (no forced quantile-based flagging)
    const entropyThresh = 4.3; // Slightly lower to catch more entropy cases
    const avgTokenLenThresh = 11.0; // Slightly lower to catch more long token cases
    const symbolDensityThresh = 0.28; // Slightly lower to catch more symbol noise
    const compressThresh = 0.92; // Much higher to reduce compress_high false positives
    const mdlThresh = 4.3; // Slightly lower to catch more MDL cases

    data.forEach((d, i) => {
        const tokens = d.norm.match(/\w+/g) || [];
        const tokenCount = tokens.length;
        if (tokenCount < 4 || HEADING_RE.test(d.raw)) return;

        // Quantile-based flagging (top 25% for each metric)
        const entropyHigh = d.entropy >= entropyThresh;
        const longTokens = d.avgTokenLen >= avgTokenLenThresh;
        const symbolNoise = d.symbolDensity >= symbolDensityThresh;
        const uniqHigh = tokenCount >= 15 && d.uniqRatio > 0.98;
        // entropy jump (use 1.5 as static threshold)
        const prev = data[i-1];
        const entropyJump = prev && prev.raw.trim() !== '' && (d.entropy - prev.entropy) > 1.5;

        // New metrics (quantile)
        const compressHigh = d.compressionRatio >= compressThresh;
        const mdlHigh = d.mdlBitsPerChar >= mdlThresh;
        const stepExcess = d.stepCount > Math.ceil(Math.sqrt(tokenCount) * Math.log2(10)); // proxy for k* formula
        const periodicityFlag = d.periodicityBias; // fires if line number is 64, 128, ...

        const coreFlags = [
            entropyHigh && 'entropy_high',
            longTokens && 'long_tokens',
            symbolNoise && 'symbol_noise',
            compressHigh && 'compress_high',
            mdlHigh && 'mdl_high',
        ].filter(Boolean) as string[];
        const auxFlags = [
            uniqHigh && 'uniq_high',
            entropyJump && 'entropy_jump',
            stepExcess && 'step_excess',
            periodicityFlag && 'periodicity_bias',
        ].filter(Boolean) as string[];

        const numCore = coreFlags.length;
        let severity: LineData['severity'];
        if (numCore >= 1) {
            severity = (numCore >= 3) ? 'HIGH' : 'WARN';
        }

        d.issues = [...coreFlags, ...auxFlags];
        d.score = coreFlags.reduce((s,f)=>s+({entropy_high:1,long_tokens:0.8,symbol_noise:0.6,compress_high:0.7,mdl_high:0.7}[f]||0),0)
                 + auxFlags.reduce((s,f)=>s+({uniq_high:0.4,entropy_jump:0.3,step_excess:0.3,periodicity_bias:0.2}[f]||0),0);
        d.severity = severity;
    });

    return data;
}

function publishDiagnostics(doc: vscode.TextDocument, data: LineData[], collection: vscode.DiagnosticCollection) {
    const diags: vscode.Diagnostic[] = [];
    data.forEach((d, idx) => {
        if (!d.severity) return;
        if (d.severity === 'INFO') return; // suppress
        if (d.score < 1.0 && d.severity === 'WARN') return; // extra guard

        const start = new vscode.Position(idx, 0);
        const end = new vscode.Position(idx, d.raw.length);
        const sev = d.severity === 'HIGH' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;

        // Detailed suggestions for all triggered metrics
        const metricDetails: Record<string, {name: string, explanation: string, exampleProblem: string, exampleSolution: string}> = {
            entropy_high: {
                name: 'entropy_high',
                explanation: 'High information density forces the LLM to process many unique patterns simultaneously, leading to increased computational load, reduced attention focus, and higher likelihood of misinterpretation or incomplete understanding.',
                exampleProblem: 'e.g. "The quick brown fox jumps over the lazy dog 1234567890!@#" (contains many unique characters, numbers, and symbols in one sentence)',
                exampleSolution: 'Break up the line into shorter, simpler sentences. Remove unnecessary numbers or symbols. Example: "The quick brown fox jumps over the lazy dog."'
            },
            long_tokens: {
                name: 'long_tokens',
                explanation: 'Long words strain the LLM\'s tokenization and embedding systems, causing subword fragmentation that disrupts semantic understanding and increases the risk of hallucination or incorrect word completion.',
                exampleProblem: 'e.g. "antidisestablishmentarianism pseudopseudohypoparathyroidism" (very long words in a single line)',
                exampleSolution: 'Replace long words with simpler alternatives or split them up. Example: "The policy was opposed by many."'
            },
            symbol_noise: {
                name: 'symbol_noise',
                explanation: 'Excessive symbols overwhelm the LLM\'s pattern recognition, causing the model to allocate attention to non-semantic elements, reducing comprehension accuracy and increasing processing latency.',
                exampleProblem: 'e.g. "Hello!!! $$$$ @@@@ ####" (many special characters in a row)',
                exampleSolution: 'Remove or reduce special symbols. Example: "Hello!"'
            },
            uniq_high: {
                name: 'uniq_high',
                explanation: 'Too many unique concepts dilute the LLM\'s attention mechanism, preventing effective pattern matching and reducing the model\'s ability to leverage learned associations, leading to weaker outputs.',
                exampleProblem: 'e.g. "apple banana cherry date elderberry fig grape" (all unique fruits in one line)',
                exampleSolution: 'Group similar items or focus on fewer unique concepts. Example: "List three fruits you like."'
            },
            entropy_jump: {
                name: 'entropy_jump',
                explanation: 'There is an abrupt jump in complexity compared to the previous line, which can break the model’s context or flow.',
                exampleProblem: 'e.g. "Simple line. Next: XyZ!@#123" (sudden switch to complex symbols/numbers)',
                exampleSolution: 'Smooth transitions between lines. Example: "Now, let’s consider a more complex example: ..."'
            },
            compress_high: {
                name: 'compress_high',
                explanation: 'Poor compressibility indicates high randomness that disrupts the LLM\'s pattern recognition abilities, forcing the model to treat each element as unpredictable, which increases processing overhead and reduces the model\'s ability to generate coherent, contextually appropriate responses.',
                exampleProblem: 'e.g. "qwertyuiopasdfghjklzxcvbnm" (random string of letters)',
                exampleSolution: 'Use more structured or repetitive phrasing. Example: "Repeat the word cat five times: cat cat cat cat cat."'
            },
            mdl_high: {
                name: 'mdl_high',
                explanation: 'This line has a high minimum description length (MDL), meaning it would require many bits to encode and may be hard for the model to compress.',
                exampleProblem: 'e.g. "XyZ!@#123" (random mix of cases, symbols, and numbers)',
                exampleSolution: 'Reduce entropy or randomness. Example: "Please summarize the following text."'
            },
            step_excess: {
                name: 'step_excess',
                explanation: 'There are too many explicit reasoning steps (chain-of-thought) for the context length, which can overwhelm the model.',
                exampleProblem: 'e.g. "Step 1: ... Step 2: ... Step 3: ... Step 4: ... Step 5: ... Step 6: ..."',
                exampleSolution: 'Condense or combine steps. Example: "Steps 1-3: Prepare the data. Steps 4-6: Train the model."'
            },
            periodicity_bias: {
                name: 'periodicity_bias',
                explanation: 'This line is at a position (e.g., every 64th) where transformer models may have positional encoding artifacts, which can affect prediction quality.',
                exampleProblem: 'e.g. Line 64, 128, 192, ... (model may behave oddly at these positions)',
                exampleSolution: 'If possible, avoid placing important instructions at these positions or add a buffer line. Example: Add a comment or blank line before line 64.'
            },
            forced_test_flag: {
                name: 'forced_test_flag',
                explanation: 'This is a test flag.',
                exampleProblem: '',
                exampleSolution: ''
            }
        };

        const details: string[] = d.issues.map(issue => {
            const det = metricDetails[issue];
            if (!det) return '';
            // Show metric name in brackets and uppercase for visibility
            return `[${det.name.toUpperCase()}]: ${det.explanation}\n  Problem: ${det.exampleProblem}\n  Solution: ${det.exampleSolution}`;
        }).filter(Boolean);

        const message = `Prompt complexity ${d.severity}: score=${d.score.toFixed(2)}\n${details.join('\n')}`;
        diags.push(new vscode.Diagnostic(new vscode.Range(start, end), message, sev));
    });
    collection.set(doc.uri, diags);
}

let timers = new Map<string, NodeJS.Timeout>();

export function activate(context: vscode.ExtensionContext) {
    const diagCollection = vscode.languages.createDiagnosticCollection('promptAnalyzer');

    function analyzeAndPublish(document: vscode.TextDocument) {
        // Accept plaintext, markdown, text, and yaml files
        if (
            document.languageId !== 'plaintext' &&
            document.languageId !== 'markdown' &&
            document.languageId !== 'text' &&
            document.languageId !== 'yaml'
        ) {
            diagCollection.clear();
            return;
        }
        const lines = document.getText().split(/\r?\n/);
        const data = computeMetrics(lines);
        publishDiagnostics(document, data, diagCollection);
    }

    function debouncedAnalyze(document: vscode.TextDocument) {
        const key = document.uri.toString();
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => {
            analyzeAndPublish(document);
        }, 600));
    }

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(analyzeAndPublish),
        vscode.workspace.onDidChangeTextDocument(e => debouncedAnalyze(e.document)),
        vscode.workspace.onDidSaveTextDocument(analyzeAndPublish),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) analyzeAndPublish(editor.document);
        })
    );

    if (vscode.window.activeTextEditor) {
        analyzeAndPublish(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('promptAnalyzer.analyzeCurrentFile', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) analyzeAndPublish(editor.document);
        })
    );
}

export function deactivate() {}
