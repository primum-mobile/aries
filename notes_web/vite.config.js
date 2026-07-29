import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const assetVersion = '20260722-desktop-webview-guard';
const nodeModulesMarker = '/node_modules/';

function packageRootForModule(moduleId) {
  const normalizedId = moduleId.replaceAll('\\', '/').split('?')[0];
  const markerIndex = normalizedId.lastIndexOf(nodeModulesMarker);
  if (markerIndex < 0) return null;

  const packagePath = normalizedId.slice(markerIndex + nodeModulesMarker.length);
  const pathParts = packagePath.split('/');
  const packageParts = pathParts[0]?.startsWith('@') ? pathParts.slice(0, 2) : pathParts.slice(0, 1);
  if (packageParts.length === 0 || packageParts.some((part) => !part)) return null;

  const root = `${normalizedId.slice(0, markerIndex + nodeModulesMarker.length)}${packageParts.join('/')}`;
  return path.normalize(root);
}

function packageLicenseFiles(packageRoot) {
  const entries = readdirSync(packageRoot, { withFileTypes: true });
  const licenseFiles = entries
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying)(?:[._-]|$)/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const noticeFiles = entries
    .filter((entry) => entry.isFile() && /^notice(?:[._-]|$)/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (licenseFiles.length === 0) {
    throw new Error(`Bundled npm package at ${packageRoot} has no LICENSE, LICENCE, or COPYING file`);
  }

  return [...licenseFiles, ...noticeFiles].map((fileName) => {
    const text = readFileSync(path.join(packageRoot, fileName), 'utf8').trim();
    if (!text) {
      throw new Error(`Bundled npm package license file is empty: ${path.join(packageRoot, fileName)}`);
    }
    return { fileName, text };
  });
}

function bundledPackageRoots(bundle) {
  const roots = new Set();
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue;
    for (const moduleId of Object.keys(output.modules)) {
      const packageRoot = packageRootForModule(moduleId);
      if (packageRoot) roots.add(packageRoot);
    }
  }
  return [...roots];
}

function thirdPartyLicenseManifest(bundle) {
  const packages = bundledPackageRoots(bundle).map((packageRoot) => {
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read metadata for bundled npm package at ${packageRoot}: ${error.message}`);
    }

    if (!metadata.name || !metadata.version) {
      throw new Error(`Bundled npm package has incomplete name/version metadata: ${packageRoot}`);
    }

    return {
      name: metadata.name,
      version: metadata.version,
      declaredLicense: metadata.license ?? 'not declared',
      licenseFiles: packageLicenseFiles(packageRoot),
    };
  });

  packages.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName || left.version.localeCompare(right.version);
  });

  const sections = packages.map((packageInfo) => {
    const licenseText = packageInfo.licenseFiles
      .map(({ fileName, text }) => `File: ${fileName}\n\n${text}`)
      .join('\n\n');
    return [
      '='.repeat(80),
      `${packageInfo.name}@${packageInfo.version}`,
      `Declared license: ${packageInfo.declaredLicense}`,
      '-'.repeat(80),
      licenseText,
    ].join('\n');
  });

  return [
    'THIRD-PARTY LICENSES - ARIES NOTES EDITOR BUNDLE',
    '',
    'This file is generated from the npm packages actually included in the built',
    'notes editor JavaScript bundle. Do not edit it by hand.',
    '',
    `Bundled packages: ${packages.length}`,
    '',
    ...sections,
    '',
  ].join('\n');
}

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'emit-aries-notes-html',
      generateBundle(_options, bundle) {
        this.emitFile({
          type: 'asset',
          fileName: 'index.html',
          source: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#232428" />
    <title>Aries Notes</title>
    <link rel="stylesheet" href="./assets/editor.css?v=${assetVersion}">
    <style>
      :root {
        --notes-background: #232428;
        --notes-surface: #1d1e21;
        --notes-raised: #2d2e31;
        --notes-text: #dcdcdd;
        --notes-muted: #999a9c;
        --notes-border: #2e2f32;
        --notes-accent: #8ea0d8;
        --notes-selection: rgba(142, 160, 216, 0.24);
        color-scheme: dark;
      }
      html,
      body,
      #notes-app {
        background: var(--notes-background);
      }
    </style>
    <script>
      (() => {
        const bridge = {
          postMessage(payload) {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage(payload, "*");
            }
          },
        };

        Object.defineProperty(window, "ariesNotes", {
          configurable: true,
          enumerable: true,
          get() {
            return bridge;
          },
          set(target) {
            if (target && typeof target === "object") {
              Object.assign(bridge, target);
            }
            bridge.postMessage = (payload) => {
              if (window.parent && window.parent !== window) {
                window.parent.postMessage(payload, "*");
              }
            };
          },
        });

        const parseMessage = (raw) => {
          if (typeof raw === "string") {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          }
          return typeof raw === "object" && raw !== null ? raw : null;
        };

        window.addEventListener("message", (event) => {
          const message = parseMessage(event.data);
          if (!message || typeof message !== "object") return;
          const type = message.type;
          if (typeof type !== "string") return;
          const payload = message.payload;

          const editor = window.AriesNotes;
          if (!editor) return;

          if (type === "setDocument" && typeof payload === "object" && payload !== null) {
            editor.setDocument?.(payload);
            return;
          }
          if (type === "focusEditor") {
            editor.focusEditor?.();
            return;
          }
          if (type === "runCommand" && typeof payload === "object" && payload !== null) {
            const command = payload.command;
            if (typeof command === "string") {
              editor.runCommand?.(command);
            }
            return;
          }
          if (type === "insertMarkdown" && typeof payload === "object" && payload !== null) {
            const markdown = payload.markdown;
            if (typeof markdown === "string") {
              editor.insertMarkdown?.(markdown);
            }
            return;
          }
          if (type === "setReadOnly" && typeof payload === "object" && payload !== null) {
            const { readonly } = payload;
            if (typeof readonly === "boolean") {
              editor.setReadOnly?.(readonly);
            }
            return;
          }
          if (type === "setTheme") {
            editor.setTheme?.(payload);
            return;
          }
          if (type === "setTitlebarSafeTop") {
            editor.setTitlebarSafeTop?.(payload);
            return;
          }
        });
      })();
    </script>
  </head>
  <body>
    <div id="notes-app">
      <div id="notes-toolbar" aria-label="Notes formatting toolbar">
        <div class="tool-group" aria-label="Text style">
          <button type="button" data-command="paragraph" title="Body text">Aa</button>
          <button type="button" data-command="h1" title="Title">T1</button>
          <button type="button" data-command="h2" title="Heading">T2</button>
        </div>
        <div class="tool-group" aria-label="Inline formatting">
          <button type="button" data-command="bold" title="Bold"><strong>B</strong></button>
          <button type="button" data-command="italic" title="Italic"><em>I</em></button>
          <button type="button" data-command="strike" title="Strikethrough"><s>S</s></button>
          <button type="button" data-command="code" title="Code">⌘</button>
        </div>
        <div class="tool-group" aria-label="Lists and blocks">
          <button type="button" data-command="bullet" title="Bulleted list">•</button>
          <button type="button" data-command="ordered" title="Numbered list">1</button>
          <button type="button" data-command="task" title="Task list">☐</button>
          <button type="button" data-command="quote" title="Blockquote">❝</button>
        </div>
        <div class="tool-group" aria-label="Insert">
          <button type="button" data-command="link" title="Link">↗</button>
        </div>
        <div class="toolbar-spacer" aria-hidden="true"></div>
        <div class="tool-group trailing" aria-label="History">
          <button type="button" data-command="undo" title="Undo">↶</button>
          <button type="button" data-command="redo" title="Redo">↷</button>
        </div>
        <button type="button" class="notes-close-button" data-close-notes title="Close notes">✕</button>
      </div>
      <main id="editor"></main>
      <div id="boot-status">Loading notes editor…</div>
    </div>
    <script src="./assets/editor.js?v=${assetVersion}"></script>
  </body>
</html>
`,
        });
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD_PARTY_LICENSES.txt',
          source: thirdPartyLicenseManifest(bundle),
        });
      },
    },
  ],
  build: {
    outDir: '../Res/notes',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/main.js',
      output: {
        format: 'iife',
        name: 'AriesNotesEditor',
        entryFileNames: 'assets/editor.js',
        assetFileNames: 'assets/editor.[ext]',
      },
    },
  },
});
