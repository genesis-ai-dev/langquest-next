import type { ReactNode } from 'react';
import { Link } from './router';
import type { Route } from './routes';
import type { LoadError } from './data';

/**
 * The dashboard's primitives, in the app's look (theme.css mirrors
 * apps/mobile/src/theme.ts): status colours never carry meaning alone, so
 * every coloured mark sits beside its words and number.
 */

export interface Crumb {
  label: string;
  to?: Route;
}

export function Page(props: { title: string; eyebrow?: string; crumbs?: Crumb[]; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="page" id="main">
      {props.crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="crumbs no-print">
          {props.crumbs.map((c, i) => (
            <span key={i}>
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              {i < props.crumbs!.length - 1 ? <span aria-hidden="true"> › </span> : null}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="page-head">
        <div>
          {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
          <h1>{props.title}</h1>
        </div>
        {props.actions ? <div className="actions no-print">{props.actions}</div> : null}
      </div>
      {props.children}
    </main>
  );
}

export function Card(props: { title?: string | undefined; eyebrow?: string | undefined; sub?: string | undefined; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`} aria-label={props.title}>
      {props.title || props.right ? (
        <div className="card-head">
          <div>
            {props.eyebrow ? <p className="eyebrow">{props.eyebrow}</p> : null}
            {props.title ? <h2>{props.title}</h2> : null}
          </div>
          {props.right}
        </div>
      ) : null}
      {props.sub ? <p className="muted small" style={{ marginTop: 0 }}>{props.sub}</p> : null}
      {props.children}
    </section>
  );
}

export function Stat(props: { label: string; value: string; sub?: string | undefined; tone?: Tone | undefined }) {
  return (
    <div className={`stat ${props.tone ? `stat-${props.tone}` : ''}`}>
      <div className="stat-value">{props.value}</div>
      <div className="stat-label">{props.label}</div>
      {props.sub ? <div className="muted small">{props.sub}</div> : null}
    </div>
  );
}

export type Tone = 'brand' | 'green' | 'amber' | 'red' | 'gray';

export function Bar(props: { value: number; tone?: Tone; label: string; tick?: number }) {
  const v = Math.max(0, Math.min(100, props.value));
  return (
    <div className="bar" role="progressbar" aria-label={props.label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`bar-fill bar-${props.tone ?? 'brand'}`} style={{ width: `${v}%` }} />
      {props.tick !== undefined ? <div className="bar-tick" style={{ left: `calc(${Math.max(0, Math.min(100, props.tick))}% - 1px)` }} aria-hidden="true" /> : null}
    </div>
  );
}

export function Badge(props: { tone: Tone; children: ReactNode }) {
  return <span className={`badge badge-${props.tone}`}>{props.children}</span>;
}

export function Notice(props: { tone: Tone; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className={`notice notice-${props.tone}`} role={props.tone === 'red' ? 'alert' : 'status'}>
      <strong>{props.title}</strong>
      {props.body ? <p>{props.body}</p> : null}
      {props.action}
    </div>
  );
}

export function Loading(props: { what: string }) {
  return <p className="muted" role="status">Loading {props.what}…</p>;
}

export function LoadFailed(props: { error: LoadError; retry: () => void }) {
  return (
    <Notice tone={props.error.offline ? 'amber' : 'red'} title={props.error.offline ? 'You are offline' : 'Something went wrong'}
      body={props.error.message}
      action={<button type="button" className="button" onClick={props.retry}>Try again</button>} />
  );
}

/** A row of toggle chips for one choice (window, filter). */
export function Chips<T extends string>(props: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o.value} type="button" className="chip" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const num = (n: number) => n.toLocaleString('en-US');
export const pctText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

export function Delta(props: { now: number; before: number; unit?: string }) {
  const d = props.now - props.before;
  if (props.before === 0 && props.now === 0) return <span className="muted">no change</span>;
  const rel = props.before > 0 ? ` (${d >= 0 ? '+' : ''}${Math.round((100 * d) / props.before)}%)` : '';
  return (
    <span className={d >= 0 ? 'delta-up' : 'delta-down'}>
      {d >= 0 ? '▲' : '▼'} {d >= 0 ? '+' : ''}{num(d)}{props.unit ? ` ${props.unit}` : ''}<span className="muted" style={{ fontWeight: 400 }}>{rel} vs the period before</span>
    </span>
  );
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `Dinka report 2026-09-29.csv`, safe on every filesystem. */
export function fileName(title: string, now = new Date()): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} ${now.toISOString().slice(0, 10)}.csv`;
}
