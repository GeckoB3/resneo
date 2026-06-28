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
 * Calendar priority: **name → service → phone → time → status** (most useful when space is tight).
 *
 * - **Shortest (`1`)** — one horizontal line; narrow widths drop lowest-priority fields first.
 * - **Tallest (`5`)** — one field per row (name, service, phone, time, status).
 * - **Between** — fields merge upward from the bottom as height increases.
 *
 * @param itemCount `5` = full booking; `4` = multi-service segment (no name row).
 */
export function pickInfoRowCount(
  contentHeightPx: number,
  itemCount: 4 | 5 = 5,
  density: BookingCardDensity = 'comfortable',
): number {
  const t =
    density === 'compact'
      ? { one: 40, two: 56, three: 72, four: 92 }
      : { one: 48, two: 66, three: 88, four: 108 };
  let raw: number;
  if (contentHeightPx < t.one) raw = 1;
  else if (contentHeightPx < t.two) raw = 2;
  else if (contentHeightPx < t.three) raw = 3;
  else if (contentHeightPx < t.four) raw = 4;
  else raw = 5;
  return Math.min(raw, itemCount);
}

const INFO_GAP_PX = 8;
const MIN_NAME_INLINE_PX = 72;
const DEFAULT_WIDTHS: Record<InfoKey, number> = {
  name: 112,
  service: 96,
  phone: 88,
  time: 74,
  pill: 82,
};

/** Legacy inline order (name-first). */
export const INLINE_INFO_FIELD_ORDER: InfoKey[] = ['name', 'service', 'phone', 'time', 'pill'];

/** Reception desk order: time and name first (UI plan §3.1). */
export const RECEPTION_INFO_FIELD_ORDER: InfoKey[] = ['time', 'name', 'pill', 'service', 'phone'];

export type BookingCardDensity = 'compact' | 'comfortable';
export type BookingCardLayout = 'reception' | 'legacy';

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
  /** Width reserved beside this block for the action tray (wide lanes). */
  actionsReservePx?: number;
  density?: BookingCardDensity;
  layout?: BookingCardLayout;
}

function metaTextClass(micro: boolean): string {
  // Colour is inherited from the bar's palette (`color: p.text` on the card shell) so meta
  // reads white on saturated fills and dark on the light amber/cancelled fills. Slight opacity
  // gives the secondary hierarchy beneath the full-strength contact name.
  return micro
    ? 'text-[10px] font-medium leading-snug opacity-[0.85]'
    : 'text-[11px] font-medium leading-snug opacity-[0.85]';
}

export function groupInfoRows(
  rowCount: number,
  hideName: boolean,
  layout: BookingCardLayout = 'legacy',
  density: BookingCardDensity = 'comfortable',
): InfoKey[][] {
  const inlineOrder = layout === 'reception' ? RECEPTION_INFO_FIELD_ORDER : INLINE_INFO_FIELD_ORDER;
  const compactReceptionOrder: InfoKey[] = ['time', 'name', 'pill', 'service'];

  if (hideName) {
    if (rowCount <= 1) return [['service', 'phone', 'time', 'pill']];
    if (rowCount === 2) return [['service', 'phone'], ['time', 'pill']];
    if (rowCount === 3) return [['service'], ['phone'], ['time', 'pill']];
    return [['service'], ['phone'], ['time'], ['pill']];
  }

  if (layout === 'reception') {
    if (density === 'compact' && rowCount <= 2) {
      return rowCount <= 1 ? [compactReceptionOrder] : [['time', 'name', 'pill'], ['service']];
    }
    if (rowCount <= 1) return [inlineOrder];
    if (rowCount === 2) return [['time', 'name', 'pill'], ['service', 'phone']];
    if (rowCount === 3) return [['time', 'name', 'pill'], ['service', 'phone']];
    if (rowCount === 4) return [['time', 'name', 'pill'], ['service'], ['phone']];
    return [['time'], ['name'], ['pill'], ['service'], ['phone']];
  }

  if (rowCount <= 1) return [INLINE_INFO_FIELD_ORDER];
  if (rowCount === 2) return [['name'], ['service', 'phone', 'time', 'pill']];
  if (rowCount === 3) return [['name'], ['service', 'phone'], ['time', 'pill']];
  if (rowCount === 4) return [['name'], ['service'], ['phone'], ['time', 'pill']];
  return [['name'], ['service'], ['phone'], ['time'], ['pill']];
}

export function pickVisibleInfoRows({
  rows,
  availableWidth,
  widths,
  fieldOrder = INLINE_INFO_FIELD_ORDER,
}: {
  rows: InfoKey[][];
  availableWidth: number;
  widths: WidthMap;
  fieldOrder?: InfoKey[];
}): InfoKey[][] {
  const widthFor = (key: InfoKey) => widths[key] ?? DEFAULT_WIDTHS[key];
  return rows
    .map((row) => {
      if (row.length === 1) return row;
      const ordered = [...row].sort(
        (a, b) => fieldOrder.indexOf(a) - fieldOrder.indexOf(b),
      );
      const visible: InfoKey[] = [];
      let used = 0;
      for (const key of ordered) {
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
      return visible.sort((a, b) => fieldOrder.indexOf(a) - fieldOrder.indexOf(b));
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
  actionsReservePx = 0,
  density = 'comfortable',
  layout = 'legacy',
}: BookingCardInfoProps) {
  const itemCount: 4 | 5 = hideName ? 4 : 5;
  const fieldOrder = layout === 'reception' ? RECEPTION_INFO_FIELD_ORDER : INLINE_INFO_FIELD_ORDER;
  const rows = pickInfoRowCount(contentHeightPx, itemCount, density);
  const groupedRows = groupInfoRows(rows, hideName, layout, density);
  const micro = contentHeightPx < 28;
  const mt = metaTextClass(micro);
  // Shrink the contact name only on the very short compact bars so it stays legible without
  // clipping. The thresholds sit below the comfortable view's minimum content height (~29px),
  // so comfortable bars always keep the full 13px name.
  const nameSizeClass =
    contentHeightPx < 20
      ? 'text-[10px] leading-none'
      : contentHeightPx < 28
        ? 'text-[12px] leading-tight'
        : 'text-[13px]';
  const timeRange = `${start}–${end}`;
  const [containerRef, containerWidth] = useMeasuredWidth<HTMLDivElement>();
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

  const availableWidth = Math.max(
    0,
    (containerWidth > 0 ? containerWidth : 0) - Math.max(0, actionsReservePx),
  );

  const visibleRows = useMemo(() => {
    const grouped = groupedRows.map((row) => row.filter((key) => availableKeys.has(key)));
    return pickVisibleInfoRows({
      rows: grouped,
      availableWidth: availableWidth > 0 ? availableWidth : 0,
      widths,
      fieldOrder,
    });
  }, [availableKeys, availableWidth, fieldOrder, groupedRows, widths]);

  const renderField = (key: InfoKey, dedicated: boolean) => {
    if (key === 'name') {
      return (
        <div
          key="name"
          // With an accessory (e.g. the compliance icon) the name must NOT grow to fill the row —
          // otherwise it pushes the icon flush against the action-button column, where the row's
          // overflow clips its ring. A small right inset keeps the icon's ring clear of that edge
          // even when a long name truncates. Bars without an accessory keep the classic grow-to-fill.
          className={`flex min-w-0 items-center gap-1.5 ${dedicated ? 'w-full' : 'max-w-full shrink'} ${
            nameAccessory ? 'pr-1' : ''
          }`}
        >
          <span
            className={`min-w-0 truncate font-extrabold tracking-tight ${nameSizeClass} ${
              nameAccessory ? '' : 'flex-1'
            }`}
          >
            {name}
          </span>
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
        <span
          key="time"
          className={`${dedicated ? 'block w-full' : 'inline-flex max-w-full shrink'} min-w-0 truncate tabular-nums ${mt}`}
          title={timeRange}
        >
          {timeRange}
        </span>
      );
    }
    if (key === 'pill' && pill) {
      return (
        <span
          key="pill"
          className={`${dedicated ? 'flex w-full min-w-0' : 'inline-flex min-w-0 max-w-full shrink-0'} items-center`}
        >
          {pill}
        </span>
      );
    }
    return null;
  };

  return (
    <div ref={containerRef} className="@container relative min-w-0 w-full max-w-full">
      <div className="pointer-events-none invisible absolute left-0 top-0 flex h-0 max-w-none gap-x-2 overflow-hidden whitespace-nowrap">
        <div ref={nameRef} className={`flex items-center gap-1.5 font-extrabold tracking-tight ${nameSizeClass}`}>
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
        <span ref={timeRef} className={`tabular-nums ${mt}`}>
          {timeRange}
        </span>
        {pill ? (
          <span ref={pillRef} className="inline-flex">
            {pill}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 max-w-full flex-col gap-y-1">
        {visibleRows.map((row, idx) => (
          <div
            key={`${idx}-${row.join('-')}`}
            className={`flex min-h-0 min-w-0 w-full items-center overflow-hidden ${
              row.length === 1 ? '' : 'gap-x-2'
            }`}
          >
            {row.map((key) => renderField(key, row.length === 1))}
          </div>
        ))}
      </div>
    </div>
  );
}
