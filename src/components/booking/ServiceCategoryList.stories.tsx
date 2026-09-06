import type { Story } from '@ladle/react';
import { ServiceCategoryList } from './ServiceCategoryList';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

/**
 * The category menu with more chips than fit the row. The row must scroll sideways,
 * fade at whichever end has more, and offer an arrow on the fade from `sm` up; the
 * chip for the section in view must be kept visible as the customer scrolls the
 * page. The widths mirror the staff booking modal (`max-w-3xl` minus its padding),
 * the public page column and a phone.
 */

type Svc = {
  id: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  sort_order: number;
  category: ServiceCategoryRef | null;
};

const CATEGORY_NAMES = [
  'Haircuts',
  'Colour',
  'Highlights and balayage',
  'Styling',
  'Treatments',
  'Beards and grooming',
  'Children',
  'Bridal and occasion',
  'Extensions',
  'Consultations',
  'Nails',
  'Brows and lashes',
];

const SERVICES: Svc[] = CATEGORY_NAMES.flatMap((name, c) => {
  const category: ServiceCategoryRef = { id: `cat-${c}`, name, sort_order: c };
  return Array.from({ length: 2 + (c % 3) }, (_, i) => ({
    id: `svc-${c}-${i}`,
    name: `${name} service ${i + 1}`,
    description: i === 0 ? 'Includes a consultation and a finish.' : null,
    duration_minutes: 30 + 15 * i,
    sort_order: i,
    category,
  }));
});

function Card({ svc }: { svc: Svc }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="font-medium text-slate-900">{svc.name}</div>
      <div className="mt-0.5 text-xs text-slate-500">{svc.duration_minutes} min</div>
    </div>
  );
}

function Frame({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <div style={{ width, margin: 16, padding: 16 }} className="rounded-2xl border border-slate-200 bg-white">
      {children}
    </div>
  );
}

const list = (embed = false) => (
  <ServiceCategoryList
    services={SERVICES}
    layout="sections"
    idPrefix="story"
    embed={embed}
    renderService={(svc) => <Card key={svc.id} svc={svc} />}
  />
);

/** Roughly the staff booking modal's content width. */
export const ManyCategoriesModalWidth: Story = () => <Frame width={720}>{list()}</Frame>;

/** The public booking page column. */
export const ManyCategoriesPublicColumn: Story = () => <Frame width={640}>{list()}</Frame>;

/** A phone: no arrows, swipe with fades. */
export const ManyCategoriesPhone: Story = () => <Frame width={360}>{list()}</Frame>;

/** The embed widget: the menu is a plain row rather than sticky, controls unchanged. */
export const ManyCategoriesEmbed: Story = () => <Frame width={480}>{list(true)}</Frame>;

/** Few categories: nothing overflows, so no fades or arrows appear. */
export const FewCategoriesFit: Story = () => (
  <Frame width={640}>
    <ServiceCategoryList
      services={SERVICES.filter((s) => (s.category?.sort_order ?? 0) < 3)}
      layout="sections"
      idPrefix="story-few"
      renderService={(svc) => <Card key={svc.id} svc={svc} />}
    />
  </Frame>
);
