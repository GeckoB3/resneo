'use client';

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Vertical layout tiers for booking info (full card: name + 4 meta fields).
 *
 * - **Shortest (`1`)** — one horizontal line: name + service + phone + time + pill.
 *   Narrow containers drop least-important fields first (see `cqPacked`).
 * - **Tallest (`5`)** — one field per row (name, service, phone, time, pill each
 *   get a full row). No width-based dropping on those dedicated rows (truncate only).
 * - **Between** — fields “move up” into fewer rows from the bottom: the bottom row
 *   stays packed until it merges upward as height increases (see `fullBody`).
 *
 * @param itemCount `5` = full booking; `4` = multi-service segment (no name row).
 */
export function pickInfoRowCount(contentHeightPx: number, itemCount: 4 | 5 = 5): number {
  let raw: number;
  if (contentHeightPx < 48) raw = 1;
  else if (contentHeightPx < 66) raw = 2;
  else if (contentHeightPx < 88) raw = 3;
  else if (contentHeightPx < 108) raw = 4;
  else raw = 5;
  return Math.min(raw, itemCount);
}

const INFO_GAP_PX = 6;
const MIN_NAME_INLINE_PX = 72;
const DEFAULT_WIDTHS: Record<InfoKey, number> = {
  name: 112,
  service: 96,
  phone: 88,
  time: 74,
  pill: 82,
};

type InfoKey = 'name' | 'service' | 'phone' | 'time' | 'pill';
type WidthMap = Partial<Record<InfoKey, number>>;

export interface BookingCardInfoProps {
  name: string;
  nameAccessory?: ReactNode;
  service: string | null;
  phone: string | null;
  start: string;
  end: string;
  pill: ReactNode | null;
  contentHeightPx: number;
  hideName?: boolean;
}

function metaTextClass(micro: boolean): string {
  return micro
    ? 'text-[9px] font-medium leading-snug text-slate-600/90'
    : 'text-[10px] font-medium leading-snug text-slate-600/90';
}

function timeChipClass(): string {
  return 'inline-flex shrink-0 items-center rounded-full bg-white/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-700 shadow-sm ring-1 ring-black/5';
}

export function groupInfoRows(rowCount: number, hideName: boolean): InfoKey[][] {
  if (hideName) {
    if (rowCount <= 1) return [['service', 'phone', 'time', 'pill']];
    if (rowCount === 2) return [['service'], ['phone', 'time', 'pill']];
    if (rowCount === 3) return [['service'], ['phone'], ['time', 'pill']];
    return [['service'], ['phone'], ['time'], ['pill']];
  }
  if (rowCount <= 1) return [['name', 'service', 'phone', 'time', 'pill']];
  if (rowCount === 2) return [['name'], ['service', 'phone', 'time', 'pill']];
  if (rowCount === 3) return [['name'], ['service'], ['phone', 'time', 'pill']];
  if (rowCount === 4) return [['name'], ['service'], ['phone'], ['time', 'pill']];
  return [['name'], ['service'], ['phone'], ['time'], ['pill']];
}

export function pickVisibleInfoRows({
  rows,
  availableWidth,
  widths,
}: {
  rows: InfoKey[][];
  availableWidth: number;
  widths: WidthMap;
}): InfoKey[][] {
  const widthFor = (key: InfoKey) => widths[key] ?? DEFAULT_WIDTHS[key];
  return rows
    .map((row) => {
      if (row.length === 1) return row;
      const visible: InfoKey[] = [];
      let used = 0;
      for (const key of row) {
        const itemWidth =
          key === 'name'
            ? Math.min(Math.max(widthFor('name'), MIN_NAME_INLINE_PX), Math.max(MIN_NAME_INLINE_PX, availableWidth))
            : widthFor(key);
        const next = used + (visible.length > 0 ? INFO_GAP_PX : 0) + itemWidth;
        if (key === 'name' || next <= availableWidth) {
          visible.push(key);
          used = next;
        }
      }
      return visible;
    })
    .filter((row) => row.length > 0);
}

function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

export function BookingCardInfo({
  name,
  nameAccessory,
  service,
  phone,
  start,
  end,
  pill,
  contentHeightPx,
  hideName = false,
}: BookingCardInfoProps) {
  const itemCount: 4 | 5 = hideName ? 4 : 5;
  const rows = pickInfoRowCount(contentHeightPx, itemCount);
  const micro = contentHeightPx < 28;
  const mt = metaTextClass(micro);
  const timeRange = `${start}–${end}`;
  const [containerRef, availableWidth] = useMeasuredWidth<HTMLDivElement>();
  const [nameRef, nameWidth] = useMeasuredWidth<HTMLDivElement>();
  const [serviceRef, serviceWidth] = useMeasuredWidth<HTMLSpanElement>();
  const [phoneRef, phoneWidth] = useMeasuredWidth<HTMLSpanElement>();
  const [timeRef, timeWidth] = useMeasuredWidth<HTMLSpanElement>();
  const [pillRef, pillWidth] = useMeasuredWidth<HTMLSpanElement>();
  const widths = useMemo(
    () => ({
      name: nameWidth || undefined,
      service: serviceWidth || undefined,
      phone: phoneWidth || undefined,
      time: timeWidth || undefined,
      pill: pillWidth || undefined,
    }),
    [nameWidth, phoneWidth, pillWidth, serviceWidth, timeWidth],
  );

  const availableKeys = useMemo(() => {
    const keys = new Set<InfoKey>();
    if (!hideName) keys.add('name');
    if (service) keys.add('service');
    if (phone) keys.add('phone');
    keys.add('time');
    if (pill) keys.add('pill');
    return keys;
  }, [hideName, phone, pill, service]);

  const visibleRows = useMemo(() => {
    const grouped = groupInfoRows(rows, hideName).map((row) => row.filter((key) => availableKeys.has(key)));
    return pickVisibleInfoRows({
      rows: grouped,
      availableWidth: availableWidth > 0 ? availableWidth : 0,
      widths,
    });
  }, [availableKeys, availableWidth, hideName, rows, widths]);

  const renderField = (key: InfoKey, dedicated: boolean) => {
    if (key === 'name') {
      return (
        <div
          key="name"
          className={`flex min-w-0 items-center gap-1.5 ${dedicated ? 'w-full' : 'max-w-full shrink'}`}
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold tracking-tight">{name}</span>
          {nameAccessory ? <div className="flex shrink-0 items-center gap-1">{nameAccessory}</div> : null}
        </div>
      );
    }
    if (key === 'service' && service) {
      return (
        <span
          key="service"
          className={`${dedicated ? 'block w-full' : 'inline-flex max-w-full shrink'} min-w-0 truncate ${mt}`}
          title={service}
        >
          {service}
        </span>
      );
    }
    if (key === 'phone' && phone) {
      return (
        <span
          key="phone"
          className={`${dedicated ? 'block w-full' : 'inline-flex max-w-full shrink'} min-w-0 truncate tabular-nums ${mt}`}
          title={phone}
        >
          {phone}
        </span>
      );
    }
    if (key === 'time') {
      return (
        <span key="time" className={timeChipClass()} title={timeRange}>
          {timeRange}
        </span>
      );
    }
    if (key === 'pill' && pill) {
      return (
        <span key="pill" className="min-w-0 max-w-full shrink-0">
          {pill}
        </span>
      );
    }
    return null;
  };

  return (
    <div ref={containerRef} className="relative min-w-0 w-full max-w-full">
      <div className="pointer-events-none invisible absolute left-0 top-0 flex h-0 max-w-none gap-x-1.5 overflow-hidden whitespace-nowrap">
        <div ref={nameRef} className="flex items-center gap-1.5 text-[13px] font-extrabold tracking-tight">
          <span>{name}</span>
          {nameAccessory ? <span>{nameAccessory}</span> : null}
        </div>
        {service ? (
          <span ref={serviceRef} className={mt}>
            {service}
          </span>
        ) : null}
        {phone ? (
          <span ref={phoneRef} className={`tabular-nums ${mt}`}>
            {phone}
          </span>
        ) : null}
        <span ref={timeRef} className={timeChipClass()}>
          {timeRange}
        </span>
        {pill ? (
          <span ref={pillRef} className="inline-flex">
            {pill}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 max-w-full flex-col gap-y-0.5">
        {visibleRows.map((row, idx) => (
          <div
            key={`${idx}-${row.join('-')}`}
            className={`flex min-h-0 min-w-0 w-full items-center overflow-hidden ${
              row.length === 1 ? '' : 'gap-x-1.5'
            }`}
          >
            {row.map((key) => renderField(key, row.length === 1))}
          </div>
        ))}
      </div>
    </div>
  );
}
