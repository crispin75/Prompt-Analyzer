<<<<<<< HEAD
# Prompt Analyzer VS Code Extension

Analyze prompt files for complexity and risk directly in VS Code. This extension highlights lines with high entropy, symbol noise, long tokens, and other metrics that may cause issues for LLMs (Large Language Models).


## Features
- Inline diagnostics for risky prompt lines
- Actionable suggestions and explanations for each flagged line
- Supports plaintext, markdown, text, and YAML files

## Metrics Explained
The extension analyzes each line using the following metrics:

- **Entropy**: Measures the information density or unpredictability of a line. High entropy means the line contains many unique or random elements, which can confuse LLMs.
- **Average Token Length**: The average length of words/tokens in the line. Long tokens can cause subword fragmentation, making it harder for LLMs to understand.
- **Unique Token Ratio**: The proportion of unique tokens to total tokens. A high ratio means the line introduces many new concepts at once, diluting model attention.
- **Symbol Density**: The fraction of non-alphanumeric symbols (e.g., !@#$%) in the line. High symbol density can distract the model from semantic content.
- **Case Switch Rate**: How often the text switches between uppercase and lowercase letters. Frequent switches can indicate unnatural or noisy text.
- **Entropy Jump**: Detects sudden increases in entropy compared to the previous line, which can break the model’s context or flow.
- **Compression Ratio**: A proxy for Kolmogorov complexity, calculated using simple run-length encoding. Low compressibility means the line is highly random or complex.
- **MDL (Minimum Description Length)**: Approximated as bits per character using entropy. High MDL means the line is hard to encode or compress, indicating complexity.
- **Step Count**: Counts explicit reasoning steps (e.g., "Step 1:", "First", "Second"). Too many steps can overwhelm the model’s context window.
- **Periodicity Bias**: Flags lines at positions (e.g., every 64th) where transformer models may have positional encoding artifacts, potentially affecting prediction quality.

Each metric is used to flag lines that may be risky or problematic for LLMs, with detailed explanations and suggestions provided inline.

## Usage
1. Open a prompt file in VS Code (supported: `.txt`, `.md`, `.yaml`, etc).
2. The extension automatically analyzes the file and highlights risky lines.
3. Hover over a warning or error to see detailed explanations and suggestions.
4. Use the command palette (`Ctrl+Shift+P`) and run `Prompt Analyzer: Analyze Current File` to manually trigger analysis.

## Installation
- **From VSIX:**
  1. Download the `.vsix` file.
  2. In VS Code, go to Extensions → `...` → `Install from VSIX...` and select the file.
- **From Marketplace:**
  1. Search for your extension name in the VS Code Marketplace and click Install.

## Development
- Clone the repo and run `npm install`.
- Use `npm run compile` to build.
- Use `npx vsce package` to create a VSIX for distribution.

## Publishing
- Update the `publisher` and `version` fields in `package.json`.
- Run `vsce publish` to upload to the Marketplace.

## License
MIT
=======
# Prompt-Analyzer
>>>>>>> 3eebdaddcdf8a0b6e640273ec1f938ee0d0a665f
