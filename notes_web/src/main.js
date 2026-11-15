// Copyright (C) 2026 Max Lange
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Editor, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import {
  createCodeBlockCommand,
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { history, redoCommand, undoCommand } from '@milkdown/kit/plugin/history';
import { indent } from '@milkdown/kit/plugin/indent';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { callCommand, getMarkdown, replaceAll } from '@milkdown/kit/utils';
import { TextSelection } from '@milkdown/prose/state';
import '@milkdown/kit/prose/view/style/prosemirror.css';
import './style.css';

let editor = null;
let ready = false;
let readyRequested = false;
let readOnly = true;
let lastPublishedDoc = null;
let currentMarkdown = '';
let pendingDocument = null;

const editorRoot = document.getElementById('editor');
const appRoot = document.getElementById('notes-app');
const statusNode = document.getElementById('boot-status');

function post(message) {
  if (window.parent !== window) window.parent.postMessage(message, '*');
}

function setStatus(text) {
  if (!statusNode) return;
  statusNode.textContent = text || '';
  statusNode.hidden = !text;
}

function getView() {
  if (!editor) return null;
  try {
    return editor.action((ctx) => ctx.get(editorViewCtx));
  } catch {
    return null;
  }
}

function setReadOnly(nextReadOnly) {
  readOnly = Boolean(nextReadOnly);
  appRoot.classList.toggle('is-readonly', readOnly);
  const view = getView();
  if (view) {
    view.setProps({ editable: () => !readOnly });
  }
}

function getMarkdownText() {
  if (!editor || !ready) return currentMarkdown;
  try {
    currentMarkdown = editor.action(getMarkdown());
  } catch {
    // Keep the last known value.
  }
  return currentMarkdown;
}

function setDocument(payload) {
  if (!ready || !editor) {
    pendingDocument = payload;
    return;
  }
  const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
  editor.action(replaceAll(markdown, true));
  lastPublishedDoc = getView()?.state.doc ?? null;
  currentMarkdown = markdown;
  setReadOnly(Boolean(payload.readonly));
}

function publishInput(markdown) {
  const doc = getView()?.state.doc;
  if (readOnly || !doc || (lastPublishedDoc && doc.eq(lastPublishedDoc))) return;
  lastPublishedDoc = doc;
  currentMarkdown = markdown ?? getMarkdownText();
  post({ type: 'input', value: currentMarkdown });
}

function closeNotes() {
  // The editor's change listener is debounced. Publish the last edit before
  // the host removes the frame and flushes its save queue.
  publishInput();
  post({ type: 'close' });
}

function requestReady() {
  readyRequested = true;
  if (ready) post({ type: 'ready' });
}

function command(key, payload) {
  if (!editor || readOnly) return false;
  try {
    return editor.action(callCommand(key, payload));
  } catch {
    return false;
  }
}

function leaveCurrentList() {
  const view = getView();
  if (!view || readOnly) return false;
  let changed = false;
  for (let i = 0; i < 8 && currentListItem(view); i += 1) {
    if (!command(liftListItemCommand.key)) break;
    changed = true;
  }
  return changed;
}

function applyBlockStyle(handler) {
  const lifted = leaveCurrentList();
  return Boolean(handler()) || lifted;
}

function currentListItem(view) {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'list_item') {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

function setCurrentListItemChecked(checked) {
  const view = getView();
  if (!view || readOnly) return false;
  const item = currentListItem(view);
  if (!item) return false;
  const tr = view.state.tr.setNodeMarkup(item.pos, undefined, {
    ...item.node.attrs,
    checked,
  });
  view.dispatch(tr.scrollIntoView());
  return true;
}

function toggleClickedTask(view, event) {
  const li = event.target instanceof Element
    ? event.target.closest('li[data-item-type="task"]')
    : null;
  if (!li || readOnly) return false;
  const rect = li.getBoundingClientRect();
  const boxLeft = rect.left - 24;
  const boxRight = rect.left - 3;
  const boxTop = rect.top;
  const boxBottom = rect.top + 24;
  if (
    event.clientX < boxLeft ||
    event.clientX > boxRight ||
    event.clientY < boxTop ||
    event.clientY > boxBottom
  ) {
    return false;
  }

  let found = null;
  view.state.doc.descendants((node, pos) => {
    if (found || node.type.name !== 'list_item' || node.attrs.checked == null) return true;
    if (view.nodeDOM(pos) === li) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  if (!found) return false;
  view.dispatch(
    view.state.tr.setNodeMarkup(found.pos, undefined, {
      ...found.node.attrs,
      checked: !found.node.attrs.checked,
    }).scrollIntoView(),
  );
  publishInput();
  event.preventDefault();
  return true;
}

function eventHasCommandModifier(event) {
  return Boolean(event.metaKey || event.ctrlKey || event.altKey);
}

function openExternalLink(event) {
  if (event.type === 'auxclick' && event.button !== 1) return;
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor) return;
  if (anchor.getAttribute('href')?.startsWith('#')) return;
  let url;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // The iframe cannot use the native shell. Forward activation to its host
  // before either the webview or editor handles the link.
  event.preventDefault();
  event.stopPropagation();
  post({ type: 'open-external', url: url.href });
}

function focusEditorAtPointer(view, event) {
  if (!view || readOnly || event.button !== 0 || event.detail !== 1 || eventHasCommandModifier(event)) {
    return false;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('button, a, input, textarea, select')) {
    return false;
  }

  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const selection = hit
    ? TextSelection.near(view.state.doc.resolve(hit.pos), 1)
    : TextSelection.atEnd(view.state.doc);
  view.dispatch(view.state.tr.setSelection(selection));
  view.focus();
  event.preventDefault();
  return true;
}

function focusEditorFromSurfaceClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('.ProseMirror')) return;
  focusEditorAtPointer(getView(), event);
}

function createTaskItem() {
  if (!editor || readOnly) return false;
  let didWrap = false;
  const view = getView();
  if (!view) return false;
  const item = currentListItem(view);
  if (!item) {
    didWrap = command(wrapInBulletListCommand.key);
  }
  return setCurrentListItemChecked(false) || didWrap;
}

function selectedPlainText(view) {
  const { from, to, empty } = view.state.selection;
  if (empty) return '';
  return view.state.doc.textBetween(from, to, ' ').trim();
}

function normalizeUrl(value) {
  const href = String(value || '').trim();
  if (!href) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return href;
  return `https://${href}`;
}

function labelFromUrl(href) {
  return href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/$/, '') || href;
}

function applyLink() {
  const view = getView();
  if (!editor || !view || readOnly) return false;
  const href = normalizeUrl(window.prompt('Link URL', 'https://'));
  if (!href) return false;
  if (!view.state.selection.empty) {
    return command(toggleLinkCommand.key, { href });
  }

  const label = window.prompt('Link text', labelFromUrl(href));
  const text = String(label || '').trim();
  if (!text) return false;

  const { state } = view;
  const mark = state.schema.marks.link.create({ href, title: null });
  const node = state.schema.text(text, [mark]);
  const tr = state.tr.replaceSelectionWith(node, false);
  const pos = tr.selection.to;
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView());
  return true;
}

function insertMarkdown(markdown) {
  if (!editor || !ready || readOnly) return false;
  const text = String(markdown || '');
  if (!text.trim()) return false;
  try {
    const current = getMarkdownText().trimEnd();
    const next = `${current ? `${current}\n\n` : ''}${text.trim()}\n`;
    setDocument({ markdown: next, readonly: false });
    currentMarkdown = next;
    post({ type: 'input', value: currentMarkdown });
    requestAnimationFrame(focusEditor);
    return true;
  } catch (error) {
    post({ type: 'error', message: `Could not insert Markdown: ${error?.message || error}` });
    return false;
  }
}

function runCommand(name) {
  const handlers = {
    paragraph: () => applyBlockStyle(() => command(turnIntoTextCommand.key)),
    bold: () => command(toggleStrongCommand.key),
    italic: () => command(toggleEmphasisCommand.key),
    strike: () => command(toggleStrikethroughCommand.key),
    h1: () => applyBlockStyle(() => command(wrapInHeadingCommand.key, 1)),
    h2: () => applyBlockStyle(() => command(wrapInHeadingCommand.key, 2)),
    h3: () => applyBlockStyle(() => command(wrapInHeadingCommand.key, 3)),
    bullet: () => applyBlockStyle(() => command(wrapInBulletListCommand.key)),
    ordered: () => applyBlockStyle(() => command(wrapInOrderedListCommand.key)),
    task: createTaskItem,
    quote: () => applyBlockStyle(() => command(wrapInBlockquoteCommand.key)),
    code: () => command(toggleInlineCodeCommand.key) || command(createCodeBlockCommand.key),
    link: applyLink,
    undo: () => command(undoCommand.key),
    redo: () => command(redoCommand.key),
  };
  const handler = handlers[name];
  return handler ? Boolean(handler()) : false;
}

function focusEditor() {
  const view = getView();
  if (!view?.editable) return false;
  view.focus();
  return document.hasFocus() && view.hasFocus();
}

function blurEditor() {
  publishInput();
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function setTheme(theme) {
  if (!theme || typeof theme !== 'object') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    if (key === 'dark') continue;
    if (value == null) continue;
    root.style.setProperty(`--notes-${key}`, String(value));
  }
  const dark = Boolean(theme.dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
}

function setTitlebarSafeTop(value) {
  const pixels = Math.max(0, Number(value) || 0);
  document.documentElement.style.setProperty('--notes-titlebar-safe-top', `${pixels}px`);
}

function bindToolbar() {
  document.getElementById('notes-toolbar')?.addEventListener('mousedown', (event) => {
    if (event.target.closest('button[data-command]')) {
      event.preventDefault();
    }
  });
  document.getElementById('notes-toolbar')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-command]');
    if (!button) return;
    event.preventDefault();
    runCommand(button.dataset.command);
    focusEditor();
  });
}

function bindEditorShortcuts() {
  const postAmbientKey = (event, eventType) => {
    if (event.key !== 'Shift' && !event.shiftKey) return;
    post({
      type: 'ambient-key',
      eventType,
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      repeat: event.repeat,
    });
  };

  window.addEventListener('keydown', (event) => {
    postAmbientKey(event, 'keydown');
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.defaultPrevented) return;
    const commandName = {
      b: 'bold',
      i: 'italic',
      k: 'link',
    }[event.key.toLowerCase()];
    if (!commandName) return;
    if (!runCommand(commandName)) return;
    event.preventDefault();
    event.stopPropagation();
    focusEditor();
  }, true);
  window.addEventListener('keyup', (event) => {
    postAmbientKey(event, 'keyup');
  }, true);
}

async function createEditor() {
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, editorRoot);
      ctx.set(defaultValueCtx, '');
      ctx.set(editorViewOptionsCtx, {
        attributes: {
          autocapitalize: 'sentences',
          autocomplete: 'off',
          spellcheck: 'true',
        },
        editable: () => !readOnly,
        handleDOMEvents: {
          focus: () => {
            post({ type: 'focus' });
            return false;
          },
          blur: () => {
            publishInput();
            post({ type: 'blur' });
            return false;
          },
          click: (view, event) => toggleClickedTask(view, event) || focusEditorAtPointer(view, event),
        },
      });
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        publishInput(markdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(clipboard)
    .use(listener)
    .use(indent)
    .use(history)
    .use(trailing)
    .create();

  ready = true;
  setStatus('');
  if (pendingDocument) {
    const payload = pendingDocument;
    pendingDocument = null;
    setDocument(payload);
  }
  if (readyRequested) requestReady();
}

window.AriesNotes = {
  blurEditor,
  closeNotes,
  focusEditor,
  getMarkdown: getMarkdownText,
  getMarkdownJSON: () => JSON.stringify(getMarkdownText()),
  insertMarkdown,
  requestReady,
  runCommand,
  setDocument,
  setReadOnly,
  setTitlebarSafeTop,
  setTheme,
};

bindToolbar();
bindEditorShortcuts();
editorRoot.addEventListener('click', openExternalLink, true);
editorRoot.addEventListener('auxclick', openExternalLink, true);
editorRoot.addEventListener('click', focusEditorFromSurfaceClick);
createEditor().catch((error) => {
  setStatus(`Notes editor failed to load: ${error?.message || error}`);
  post({ type: 'error', message: String(error?.message || error) });
});
