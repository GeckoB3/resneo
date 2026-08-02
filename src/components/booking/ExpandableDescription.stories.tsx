import type { Story } from '@ladle/react';
import { ExpandableDescription } from './appointment-public-ui';

/**
 * The toggle only appears when the text genuinely overflows three lines, so these stories exist to
 * check the boundary: a one-liner must show no control at all, and a borderline description must not
 * offer "Show more" for a line it is not actually hiding.
 */

const SHORT = 'A quick tidy up of the edges.';

const BORDERLINE =
  'A relaxing treatment that covers the scalp, neck and shoulders, finishing with a light massage.';

const LONG =
  'Our full piano service covers tuning to concert pitch, regulation of the action, and voicing of ' +
  'the hammers. We check the pinblock and bridges for movement, inspect the soundboard for cracks, ' +
  'and adjust key height and dip so the touch is even across the whole keyboard. Older instruments ' +
  'that have not been maintained for several years may need a pitch raise first, which we will ' +
  'discuss with you before starting. Please make sure the room is at a normal temperature for a ' +
  'couple of hours beforehand, and that we can reach the back of the instrument.';

function Card({ children, width = 420 }: { children: React.ReactNode; width?: number }) {
  return (
    <div style={{ maxWidth: width, margin: 16 }}>
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
        <div className="font-medium text-slate-900">Piano tuning</div>
        <div className="mt-0.5 text-xs text-slate-500">90 min</div>
        {children}
      </div>
    </div>
  );
}

export const ShortNoToggle: Story = () => (
  <Card>
    <ExpandableDescription description={SHORT} idSuffix="short" />
  </Card>
);

export const Borderline: Story = () => (
  <Card>
    <ExpandableDescription description={BORDERLINE} idSuffix="borderline" />
  </Card>
);

export const LongExpandable: Story = () => (
  <Card>
    <ExpandableDescription description={LONG} idSuffix="long" />
  </Card>
);

export const NarrowColumn: Story = () => (
  <Card width={260}>
    <ExpandableDescription description={LONG} idSuffix="narrow" />
  </Card>
);

export const EmptyRendersNothing: Story = () => (
  <Card>
    <ExpandableDescription description="   " idSuffix="empty" />
  </Card>
);
