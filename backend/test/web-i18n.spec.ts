import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import vm from 'vm';

// Every Arabic UI string in the web app must be wrapped (T('…') / L`…`) and have an English entry.
const html = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8');
const i18nSrc = readFileSync(join(__dirname, '..', 'public', 'i18n.js'), 'utf8');
const AR = /[؀-ۿ]/;
const ATTR = /\b(placeholder|title|aria-label|alt|content)="([^"]*)"/g;
const ent = (x: string) => x.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function loadRuntime(lang: string) {
  const store: Record<string, string> = { ns_lang: lang };
  const sandbox: any = {
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: () => {} },
    document: { documentElement: {}, title: '' },
    location: { reload: () => {} },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(i18nSrc, sandbox);
  return sandbox;
}

function segments() {
  const segs = new Set<string>();
  const collect = (str: string) => {
    for (const part of str.split(/(<[^>]*>)/)) {
      if (part.startsWith('<')) {
        for (const m of part.matchAll(ATTR)) { const v = ent(m[2]).replace(/\s+/g, ' ').trim(); if (AR.test(v)) segs.add(v.replace(/\d+/g, '{}')); }
        continue;
      }
      const core = ent(part).replace(/\s+/g, ' ').trim();
      if (AR.test(core)) segs.add(core.replace(/\d+/g, '{}'));
    }
  };
  const s0 = html.indexOf('<script>\n(() =>');
  const js = html.slice(s0 + 8, html.indexOf('</script>', s0));
  collect(html.slice(0, s0).replace(/<style>[\s\S]*?<\/style>/g, ''));
  const unwrapped: string[] = [];
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script' });
  walk.fullAncestor(ast, (node: any, _s: any, anc: any[]) => {
    const parent = anc[anc.length - 2];
    if (node.type === 'Literal' && typeof node.value === 'string' && AR.test(node.value)) {
      if (parent?.type === 'Property' && parent.key === node) return;
      if (!(parent?.type === 'CallExpression' && parent.callee.name === 'T')) unwrapped.push(node.value);
      collect(node.value);
    } else if (node.type === 'TemplateLiteral' && node.quasis.some((q: any) => AR.test(q.value.cooked))) {
      if (!(parent?.type === 'TaggedTemplateExpression' && parent.tag.name === 'L')) unwrapped.push(node.quasis[0].value.cooked);
      let j = '';
      node.quasis.forEach((q: any, i: number) => { j += q.value.cooked; if (i < node.expressions.length) j += `${i}`; });
      collect(j);
    }
  });
  return { segs: [...segs], unwrapped };
}

describe('web app i18n', () => {
  it('all Arabic strings are wrapped and translated', () => {
    const { segs, unwrapped } = segments();
    expect(unwrapped).toEqual([]);
    const rt = loadRuntime('en');
    const missing = segs.filter((s) => rt.T(s) === s && !['العربية'].includes(s));
    expect(missing).toEqual([]);
  });

  it('runtime: L tags keep values, reorder-safe, and Arabic passes through', () => {
    const en = loadRuntime('en');
    const n = 450;
    expect(en.L`<b>${n}</b> سعرة`).toBe('<b>450</b> kcal');
    expect(en.L`تجاوزت هدف اليوم بـ ${n} سعرة`).toBe("Over today's target by 450 kcal");
    expect(en.T('<div class="muted">لا توجد وجبات بعد.</div>')).toBe('<div class="muted">No meals yet.</div>');
    const ar = loadRuntime('ar');
    expect(ar.L`تجاوزت هدف اليوم بـ ${n} سعرة`).toBe('تجاوزت هدف اليوم بـ 450 سعرة');
    expect(ar.document.documentElement.dir).toBe('rtl');
    expect(en.document.documentElement.dir).toBe('ltr');
  });
});
