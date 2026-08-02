import type { Story } from '@ladle/react';
import { useState } from 'react';
import { BookingIntervalEditor, type BookingIntervalValue } from './BookingIntervalEditor';

function Harness({ initial, spanMinutes }: { initial: BookingIntervalValue; spanMinutes: number }) {
  const [value, setValue] = useState<BookingIntervalValue>(initial);
  return (
    <div style={{ maxWidth: 620, padding: 16 }}>
      <BookingIntervalEditor
        intervalMinutes={value.booking_interval_minutes}
        minuteMarks={value.booking_minute_marks}
        startTimes={value.booking_start_times}
        spanMinutes={spanMinutes}
        onChange={setValue}
        fieldIdSuffix="story"
      />
      <pre style={{ marginTop: 16, fontSize: 12 }}>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export const IntervalMode: Story = () => (
  <Harness
    spanMinutes={30}
    initial={{ booking_interval_minutes: 15, booking_minute_marks: null, booking_start_times: null }}
  />
);

export const FixedTimes: Story = () => (
  <Harness
    spanMinutes={90}
    initial={{
      booking_interval_minutes: 15,
      booking_minute_marks: null,
      booking_start_times: ['09:20', '11:30', '13:45', '15:30'],
    }}
  />
);

export const FixedTimesTooClose: Story = () => (
  <Harness
    spanMinutes={45}
    initial={{
      booking_interval_minutes: 15,
      booking_minute_marks: null,
      booking_start_times: ['10:00', '10:30'],
    }}
  />
);
