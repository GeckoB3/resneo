import type { Story } from '@ladle/react';
import { useState } from 'react';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { ProcessingTimeTimelineEditor } from './ProcessingTimeTimelineEditor';

function Harness({
  initial,
  durationMinutes,
  bufferMinutes,
}: {
  initial: ProcessingTimeBlock[];
  durationMinutes: number;
  bufferMinutes: number;
}) {
  const [blocks, setBlocks] = useState<ProcessingTimeBlock[]>(initial);
  return (
    <div style={{ maxWidth: 620, padding: 16 }}>
      <ProcessingTimeTimelineEditor
        durationMinutes={durationMinutes}
        bufferMinutes={bufferMinutes}
        blocks={blocks}
        onChange={setBlocks}
      />
      <pre data-testid="blocks" style={{ marginTop: 16, fontSize: 12 }}>
        {JSON.stringify(
          blocks.map((b) => ({ start: b.start_minute, length: b.duration_minutes })),
          null,
          2,
        )}
      </pre>
    </div>
  );
}

/** Press "Add processing period": the block starts at the end of the service and runs on after it. */
export const Empty: Story = () => <Harness durationMinutes={60} bufferMinutes={10} initial={[]} />;

/** Lengthen the block: its start moves earlier, it keeps ending at 60. */
export const BlockAtEnd: Story = () => (
  <Harness durationMinutes={60} bufferMinutes={10} initial={[{ id: 'a', start_minute: 50, duration_minutes: 10 }]} />
);

/** A colour: 60 minutes applying, then 30 minutes developing after the service. Lengthen it and it grows later. */
export const TailAfterService: Story = () => (
  <Harness durationMinutes={60} bufferMinutes={10} initial={[{ id: 't', start_minute: 60, duration_minutes: 30 }]} />
);

/** A gap in the middle plus a wait after: the second "Add" fills backwards inside the service. */
export const MiddleAndTail: Story = () => (
  <Harness
    durationMinutes={90}
    bufferMinutes={0}
    initial={[
      { id: 'm', start_minute: 20, duration_minutes: 20 },
      { id: 't', start_minute: 90, duration_minutes: 30 },
    ]}
  />
);
