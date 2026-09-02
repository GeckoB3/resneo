'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ServicesLayout } from '@/lib/booking/booking-page-theme';
import {
  groupServicesByCategory,
  hasServiceCategories,
  serviceCategoryDomId,
  serviceMatchesSearch,
  SERVICE_SEARCH_MIN_SERVICES,
  type CategorisableService,
  type ServiceCategoryGroup,
} from '@/lib/booking/service-categories';

/**
 * The service menu on every booking surface: the public page, the embed widget,
 * the staff booking modal and the marketing Services tab.
 *
 * A venue with no categories gets the flat list it always had, wrapped in nothing
 * new. Once it has categories the list becomes either headed sections with a
 * category menu that jumps to and tracks them, or collapsible categories. A search
 * box appears on long menus in both modes, and while the customer is typing the
 * matches show flat under their category names so nothing is hidden behind a
 * closed heading. See Docs/service-categories-plan.md.
 */

export type ServiceCategoryListItem = CategorisableService & {
  id: string;
  description?: string | null;
};

export interface ServiceCategoryListProps<T extends ServiceCategoryListItem> {
  services: readonly T[];
  layout: ServicesLayout;
  renderService: (svc: T) => ReactNode;
  /** Class for the element that holds the cards of one group (default `space-y-2`). */
  listClassName?: string;
  /** Prefix for the DOM ids of sections and panels, unique per list on the page. */
  idPrefix?: string;
  /** A service that must stay visible: its category starts open in accordion mode. */
  revealServiceId?: string | null;
  /**
   * Inside the embed iframe there is no scrollport, so a sticky menu cannot stick.
   * The menu still renders, as a plain row.
   */
  embed?: boolean;
  /** Force the search box on or off; by default it appears from six services. */
  searchable?: boolean;
  searchPlaceholder?: string;
}

const CHIP_BASE =
  'inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';
const CHIP_ACTIVE = 'bg-brand-600 text-white shadow-sm';
const CHIP_INACTIVE = 'bg-brand-50 text-brand-700 hover:bg-brand-100';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function ChevronIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`${className ?? 'h-5 w-5'} transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
    </svg>
  );
}

function pluralServices(n: number): string {
  return `${n} service${n === 1 ? '' : 's'}`;
}

export function ServiceCategoryList<T extends ServiceCategoryListItem>({
  services,
  layout,
  renderService,
  listClassName = 'space-y-2',
  idPrefix,
  revealServiceId = null,
  embed = false,
  searchable,
  searchPlaceholder = 'Search services',
}: ServiceCategoryListProps<T>) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const prefix = idPrefix ?? `svc${reactId}`;
  const reducedMotion = usePrefersReducedMotion();

  const groups = useMemo(() => groupServicesByCategory(services), [services]);
  const categorised = useMemo(() => hasServiceCategories(services), [services]);
  const showSearch = searchable ?? services.length >= SERVICE_SEARCH_MIN_SERVICES;

  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim();
  const searching = showSearch && trimmedQuery.length > 0;

  const filteredGroups = useMemo<ServiceCategoryGroup<T>[]>(() => {
    if (!searching) return groups;
    return groups
      .map((g) => ({ ...g, services: g.services.filter((s) => serviceMatchesSearch(s, trimmedQuery)) }))
      .filter((g) => g.services.length > 0);
  }, [groups, searching, trimmedQuery]);
  const matchCount = useMemo(
    () => filteredGroups.reduce((n, g) => n + g.services.length, 0),
    [filteredGroups],
  );

  // ── Accordion state ───────────────────────────────────────────────────────
  const revealGroupId = useMemo(() => {
    if (!revealServiceId) return undefined;
    const g = groups.find((group) => group.services.some((s) => s.id === revealServiceId));
    return g ? g.id : undefined;
  }, [groups, revealServiceId]);
  // The customer's own opens and closes, over the defaults (the first category,
  // plus the one holding a revealed service). Overrides rather than a copied set,
  // so a reveal that arrives later needs no effect to apply.
  const [toggles, setToggles] = useState<Map<string | null, boolean>>(() => new Map());
  const isGroupOpen = useCallback(
    (id: string | null) => {
      const override = toggles.get(id);
      if (override !== undefined) return override;
      return (groups.length > 0 && id === groups[0]!.id) || (revealGroupId !== undefined && id === revealGroupId);
    },
    [toggles, groups, revealGroupId],
  );
  const toggleGroup = useCallback(
    (id: string | null) => {
      setToggles((prev) => {
        const next = new Map(prev);
        next.set(id, !isGroupOpen(id));
        return next;
      });
    },
    [isGroupOpen],
  );

  // ── Section tracking for the category menu ────────────────────────────────
  const [activeId, setActiveId] = useState<string | null | undefined>(undefined);
  const suppressTrackingUntil = useRef(0);
  const navRef = useRef<HTMLElement | null>(null);
  const useMenu = categorised && layout === 'sections' && !searching;

  useEffect(() => {
    if (!useMenu || typeof IntersectionObserver === 'undefined') return;
    const sections = groups
      .map((g) => document.getElementById(serviceCategoryDomId(prefix, g.id)))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        if (Date.now() < suppressTrackingUntil.current) return;
        const first = groups.find((g) => visible.get(serviceCategoryDomId(prefix, g.id)));
        if (first) setActiveId(first.id);
      },
      // The band just below the sticky menu: a section counts as current once
      // its top third has scrolled under the menu.
      { rootMargin: '-15% 0px -60% 0px', threshold: [0, 0.01] },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [useMenu, groups, prefix]);

  const jumpTo = useCallback(
    (id: string | null) => {
      setActiveId(id);
      suppressTrackingUntil.current = Date.now() + 700;
      const el = document.getElementById(serviceCategoryDomId(prefix, id));
      if (!el) return;
      el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    },
    [prefix, reducedMotion],
  );

  // Measured, not read from the ref during render: a section's scroll margin has
  // to clear the sticky menu, whose height depends on how the chips wrap.
  const [navHeight, setNavHeight] = useState(0);
  useEffect(() => {
    const el = navRef.current;
    if (!useMenu || !el) return;
    const measure = () => setNavHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [useMenu]);
  const sectionStyle: CSSProperties = {
    scrollMarginTop: `calc(var(--ap-sticky-top, 0px) + ${navHeight + 12}px)`,
  };

  // ── Rendering ─────────────────────────────────────────────────────────────
  const searchBox = showSearch ? (
    <div className="mb-3">
      <label htmlFor={`${prefix}-search`} className="sr-only">
        {searchPlaceholder}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center">
          <SearchIcon />
        </span>
        <input
          id={`${prefix}-search`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          autoComplete="off"
          enterKeyHint="search"
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute inset-y-0 right-2 flex items-center rounded-full px-1.5 text-slate-400 hover:text-slate-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite">
        {searching ? `${pluralServices(matchCount)} match` : ''}
      </p>
    </div>
  ) : null;

  const groupHeading = (group: ServiceCategoryGroup<T>, headingId: string) => (
    <h3 id={headingId} className="flex items-baseline gap-2 text-base font-semibold text-slate-900">
      <span>{group.name}</span>
      <span className="text-xs font-normal text-slate-400">{group.services.length}</span>
    </h3>
  );

  // Flat list: no categories and not searching. Exactly what the surface rendered before.
  if (!categorised && !searching) {
    return (
      <div>
        {searchBox}
        <div className={listClassName}>{services.map((svc) => renderService(svc))}</div>
      </div>
    );
  }

  if (searching) {
    return (
      <div>
        {searchBox}
        {matchCount === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-700">No services match &ldquo;{trimmedQuery}&rdquo;</p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Show all services
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {filteredGroups.map((group) => (
              <section key={group.id ?? 'other'} aria-label={group.name || 'Services'} className="space-y-2">
                {group.name ? (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.name}</p>
                ) : null}
                <div className={listClassName}>{group.services.map((svc) => renderService(svc))}</div>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (layout === 'accordion') {
    return (
      <div>
        {searchBox}
        <div className="space-y-2">
          {groups.map((group) => {
            const open = isGroupOpen(group.id);
            const panelId = serviceCategoryDomId(prefix, group.id);
            const buttonId = `${panelId}-button`;
            return (
              <section key={group.id ?? 'other'} className="ap-cat-accordion overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <h3 className="m-0">
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-base font-semibold text-slate-900">{group.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">{pluralServices(group.services.length)}</span>
                    </span>
                    <ChevronIcon open={open} className="h-5 w-5 shrink-0 text-brand-600" />
                  </button>
                </h3>
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                    open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    aria-hidden={!open}
                    className="min-h-0 overflow-hidden"
                    style={{
                      visibility: open ? 'visible' : 'hidden',
                      transition: reducedMotion ? undefined : `visibility 0s linear ${open ? '0s' : '300ms'}`,
                    }}
                  >
                    <div className={`border-t border-slate-100 px-3 pb-3 pt-3 ${listClassName}`}>
                      {group.services.map((svc) => renderService(svc))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  // Sections with a category menu.
  const currentId = activeId === undefined ? groups[0]?.id : activeId;
  return (
    <div>
      {searchBox}
      <nav
        ref={navRef}
        aria-label="Service categories"
        className={`ap-cat-nav -mx-1 mb-4 px-1 ${embed ? '' : 'sticky z-[5]'}`}
        style={embed ? undefined : { top: 'var(--ap-sticky-top, 0px)' }}
      >
        <div className="ap-cat-nav-inner flex gap-2 overflow-x-auto py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((group) => {
            const active = currentId === group.id;
            return (
              <button
                key={group.id ?? 'other'}
                type="button"
                onClick={() => jumpTo(group.id)}
                aria-current={active ? 'true' : undefined}
                className={`${CHIP_BASE} ${active ? CHIP_ACTIVE : CHIP_INACTIVE}`}
              >
                {group.name}
                <span className={`text-xs ${active ? 'text-white/80' : 'text-brand-500'}`}>{group.services.length}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <div className="space-y-7">
        {groups.map((group) => {
          const sectionId = serviceCategoryDomId(prefix, group.id);
          const headingId = `${sectionId}-heading`;
          return (
            <section key={group.id ?? 'other'} id={sectionId} aria-labelledby={headingId} style={sectionStyle} className="space-y-3">
              {groupHeading(group, headingId)}
              <div className={listClassName}>{group.services.map((svc) => renderService(svc))}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
