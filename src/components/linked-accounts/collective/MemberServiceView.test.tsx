/** @vitest-environment happy-dom */
/**
 * A service from the host, as its member reads it (UX spec §2 item 3; W6): the member's own
 * settings, including what its guests are told beforehand (D53), are sent back as changed.
 */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberServiceView } from './MemberServiceView';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';

const block: CollectiveServiceBlock = {
  role: 'replica',
  collective_id: 'c-1',
  collective_name: 'Northside',
  host_venue_name: 'Host Venue',
  item_id: 'item-1',
  locked_fields: ['name'],
  delegated_fields: ['pre_appointment_instructions'],
  status: 'up_to_date',
  status_reason: null,
  last_applied_at: null,
  hidden_reasons: [],
};

const show = (onSave = vi.fn()) => {
  render(
    <MemberServiceView
      open
      onClose={vi.fn()}
      service={{ name: 'Cut', location_type: 'business_venue', pre_appointment_instructions: 'Park at the back' }}
      block={block}
      calendars={[{ id: 'cal-1', name: 'Chair 1', offers: true }]}
      onSave={onSave}
    />,
  );
  return onSave;
};

describe('MemberServiceView', () => {
  it("lets the member say what its guests should know beforehand", async () => {
    const onSave = show();
    const user = userEvent.setup();
    const box = screen.getByRole('textbox', { name: /Before the appointment/ });
    expect(box).toHaveValue('Park at the back');
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
    await user.clear(box);
    await user.type(box, 'Use the side door');
    await user.click(screen.getByRole('button', { name: /Save/ }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ practitioner_ids: ['cal-1'], pre_appointment_instructions: 'Use the side door' }),
    );
  });
});
