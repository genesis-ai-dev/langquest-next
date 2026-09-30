import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { hrefFor, parseRoute, type Route } from './routes';

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

/** Go to a page. `replace` for filter changes, so Back leaves the page instead of undoing a filter. */
export function navigate(to: Route, opts: { replace?: boolean } = {}) {
  const href = hrefFor(to);
  if (href !== window.location.pathname + window.location.search) {
    if (opts.replace) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
  }
  if (!opts.replace) window.scrollTo(0, 0);
  for (const l of listeners) l();
}

const current = () => window.location.pathname + window.location.search;

export function useRoute(): Route {
  const url = useSyncExternalStore(subscribe, current);
  const q = url.indexOf('?');
  return parseRoute(q < 0 ? url : url.slice(0, q), q < 0 ? '' : url.slice(q));
}

/** A real link (open in a new tab works); a plain click navigates in place. */
export function Link(props: { to: Route } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { to, onClick, ...rest } = props;
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={hrefFor(to)} onClick={click} {...rest} />;
}
