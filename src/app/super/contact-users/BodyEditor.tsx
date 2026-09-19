'use client';

import { useRef, useState } from 'react';

type InsertKind = 'link' | 'button' | 'image';

interface Props {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
}

type ToolKey = 'h2' | 'h3' | 'bold' | 'italic' | 'ul' | 'ol' | 'quote' | 'link' | 'button' | 'image' | 'hr';

interface ToolButton {
  key: ToolKey;
  title: string;
  icon: React.ReactNode;
}

const iconCls = 'h-4 w-4';

/**
 * Markdown textarea with a formatting toolbar. Every button writes plain markdown, so what is
 * typed is always what the preview (and the sent email) renders.
 */
export function BodyEditor({ value, onChange, maxLength }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [insert, setInsert] = useState<InsertKind | null>(null);
  const [insertText, setInsertText] = useState('');
  const [insertUrl, setInsertUrl] = useState('');
  const savedSelection = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  function selection() {
    const el = ref.current;
    if (!el) return { start: value.length, end: value.length, text: '' };
    return { start: el.selectionStart, end: el.selectionEnd, text: value.slice(el.selectionStart, el.selectionEnd) };
  }

  function replaceRange(start: number, end: number, text: string, selectFrom?: number, selectTo?: number) {
    const next = value.slice(0, start) + text + value.slice(end);
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selectFrom ?? start + text.length, selectTo ?? start + text.length);
    });
  }

  function wrap(marker: string, placeholder: string) {
    const { start, end, text } = selection();
    const inner = text || placeholder;
    replaceRange(start, end, `${marker}${inner}${marker}`, start + marker.length, start + marker.length + inner.length);
  }

  /** Prefixes every selected line (or the current line) with a block marker. */
  function prefixLines(prefix: (i: number) => string) {
    const { start, end } = selection();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const next = lines.map((l, i) => `${prefix(i)}${l.replace(/^(#{1,3} |[-*] |\d+\. |> )/, '')}`).join('\n');
    replaceRange(lineStart, lineEnd, next);
  }

  /** Inserts a block on its own line with blank lines around it. */
  function insertBlock(block: string) {
    const { start, end } = selection();
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trail = after.startsWith('\n\n') || after.length === 0 ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    replaceRange(start, end, `${lead}${block}${trail}`);
  }

  function openInsert(kind: InsertKind) {
    const s = selection();
    savedSelection.current = { start: s.start, end: s.end };
    setInsertText(kind === 'image' ? '' : s.text);
    setInsertUrl('');
    setInsert(kind);
  }

  function confirmInsert() {
    const url = insertUrl.trim();
    const text = insertText.trim();
    if (!url) return;
    const { start, end } = savedSelection.current;
    if (insert === 'link') {
      const label = text || url;
      replaceRange(start, end, `[${label}](${url})`);
    } else if (insert === 'button') {
      const block = `[[button: ${text || 'Find out more'} | ${url}]]`;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const trail = after.startsWith('\n\n') || after.length === 0 ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      replaceRange(start, end, `${lead}${block}${trail}`);
    } else if (insert === 'image') {
      const before = value.slice(0, start);
      const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      replaceRange(start, end, `${lead}![${text || 'Image'}](${url})\n\n`);
    }
    setInsert(null);
  }

  const tools: Array<ToolButton | 'sep'> = [
    {
      key: 'h2',
      title: 'Heading',
      icon: <span className="text-[13px] font-bold">H1</span>,
    },
    {
      key: 'h3',
      title: 'Small heading',
      icon: <span className="text-[12px] font-bold">H2</span>,
    },
    'sep',
    {
      key: 'bold',
      title: 'Bold (Ctrl+B)',
      icon: <span className="text-sm font-bold">B</span>,
    },
    {
      key: 'italic',
      title: 'Italic (Ctrl+I)',
      icon: <span className="font-serif text-sm italic">I</span>,
    },
    'sep',
    {
      key: 'ul',
      title: 'Bulleted list',
      icon: (
        <svg className={iconCls} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <circle cx="4" cy="5.5" r="1.4" />
          <circle cx="4" cy="10" r="1.4" />
          <circle cx="4" cy="14.5" r="1.4" />
          <rect x="7.5" y="4.7" width="10" height="1.6" rx=".8" />
          <rect x="7.5" y="9.2" width="10" height="1.6" rx=".8" />
          <rect x="7.5" y="13.7" width="10" height="1.6" rx=".8" />
        </svg>
      ),
    },
    {
      key: 'ol',
      title: 'Numbered list',
      icon: (
        <svg className={iconCls} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <text x="1.5" y="7.5" fontSize="6" fontWeight="700">1</text>
          <text x="1.5" y="12" fontSize="6" fontWeight="700">2</text>
          <text x="1.5" y="16.5" fontSize="6" fontWeight="700">3</text>
          <rect x="7.5" y="4.7" width="10" height="1.6" rx=".8" />
          <rect x="7.5" y="9.2" width="10" height="1.6" rx=".8" />
          <rect x="7.5" y="13.7" width="10" height="1.6" rx=".8" />
        </svg>
      ),
    },
    {
      key: 'quote',
      title: 'Highlighted callout',
      icon: (
        <svg className={iconCls} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <rect x="2.5" y="4" width="15" height="12" rx="3" />
          <path d="M5.5 4v12" strokeWidth="2.4" />
        </svg>
      ),
    },
    'sep',
    {
      key: 'link',
      title: 'Link',
      icon: (
        <svg className={iconCls} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1" />
          <path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
        </svg>
      ),
    },
    {
      key: 'button',
      title: 'Button',
      icon: (
        <span className="rounded-full bg-slate-700 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide text-white">
          Btn
        </span>
      ),
    },
    {
      key: 'image',
      title: 'Image',
      icon: (
        <svg className={iconCls} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
          <circle cx="7" cy="8" r="1.5" />
          <path d="m3 15 4.5-4.5 3 3 2.5-2.5L17 15" />
        </svg>
      ),
    },
    {
      key: 'hr',
      title: 'Divider line',
      icon: (
        <svg className={iconCls} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <rect x="2" y="9.2" width="16" height="1.6" rx=".8" />
        </svg>
      ),
    },
  ];

  function runTool(key: ToolKey) {
    switch (key) {
      case 'h2':
        return prefixLines(() => '## ');
      case 'h3':
        return prefixLines(() => '### ');
      case 'bold':
        return wrap('**', 'bold text');
      case 'italic':
        return wrap('*', 'italic text');
      case 'ul':
        return prefixLines(() => '- ');
      case 'ol':
        return prefixLines((i) => `${i + 1}. `);
      case 'quote':
        return prefixLines(() => '> ');
      case 'link':
      case 'button':
      case 'image':
        return openInsert(key);
      case 'hr':
        return insertBlock('---');
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      wrap('**', 'bold text');
    } else if (k === 'i') {
      e.preventDefault();
      wrap('*', 'italic text');
    } else if (k === 'k') {
      e.preventDefault();
      openInsert('link');
    }
  }

  const insertTitle = insert === 'link' ? 'Add a link' : insert === 'button' ? 'Add a button' : 'Add an image';
  const textLabel = insert === 'link' ? 'Link text' : insert === 'button' ? 'Button text' : 'Description (for screen readers)';
  const urlLabel = insert === 'image' ? 'Image address (https://...)' : 'Web address';
  const urlPlaceholder = insert === 'image' ? 'https://...' : 'https://... or /dashboard/settings';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50/80 px-2 py-1.5">
        {tools.map((t, i) =>
          t === 'sep' ? (
            <span key={`sep-${i}`} className="mx-1 h-5 w-px bg-slate-200" />
          ) : (
            <button
              key={t.key}
              type="button"
              title={t.title}
              aria-label={t.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runTool(t.key)}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm"
            >
              {t.icon}
            </button>
          ),
        )}
      </div>

      {insert ? (
        <div className="space-y-2 border-b border-slate-100 bg-blue-50/50 px-3 py-3">
          <p className="text-xs font-semibold text-slate-700">{insertTitle}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">{textLabel}</span>
              <input
                value={insertText}
                onChange={(e) => setInsertText(e.target.value)}
                placeholder={insert === 'button' ? 'Find out more' : ''}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-500">{urlLabel}</span>
              <input
                value={insertUrl}
                onChange={(e) => setInsertUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmInsert();
                  }
                }}
                autoFocus
                placeholder={urlPlaceholder}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
              />
            </label>
          </div>
          {insert === 'image' ? (
            <p className="text-[11px] text-slate-500">
              Use an image that is already online at an https address. It is shown full width, so a landscape image
              about 1200 pixels wide works best.
            </p>
          ) : (
            <p className="text-[11px] text-slate-500">
              Links starting with / point at ResNeo, for example /dashboard or /help/getting-started.
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmInsert}
              disabled={!insertUrl.trim()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              Insert
            </button>
            <button
              type="button"
              onClick={() => setInsert(null)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        onKeyDown={onKeyDown}
        rows={16}
        spellCheck
        placeholder={'Write your message here.\n\nUse the toolbar for headings, lists, callouts and buttons.'}
        className="block min-h-[320px] w-full resize-y border-0 px-4 py-3 font-mono text-[13px] leading-6 text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-400">
        <span>
          **bold** &nbsp; *italic* &nbsp; ## heading &nbsp; - list &nbsp; &gt; callout &nbsp; [[button: Text | link]]
        </span>
        <span>
          {value.length.toLocaleString()} / {maxLength.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
