import type { Story } from '@ladle/react';
import { BookingLocationCallout } from './BookingLocationCallout';
import { resolveStaffBookingLocation } from '@/lib/booking/staff-booking-location';

/**
 * Every state a staff member can hit, including the ones that only appear when data is missing:
 * those are the cases that decide whether the callout is useful or just alarming.
 */

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 420, margin: 16 }}>
      <p style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{label}</p>
      {children}
    </div>
  );
}

const ADDRESS = {
  location_type: 'client_address',
  client_address_line1: '12 High Street',
  client_address_line2: 'Flat 2',
  client_address_city: 'Belfast',
  client_address_postcode: 'BT1 1AA',
};

export const ClientAddress: Story = () => (
  <Frame label="Client address, full">
    <BookingLocationCallout view={resolveStaffBookingLocation(ADDRESS)} />
  </Frame>
);

export const ClientAddressDense: Story = () => (
  <Frame label="Client address, dense (popover)">
    <BookingLocationCallout view={resolveStaffBookingLocation(ADDRESS)} dense />
  </Frame>
);

export const ClientAddressMissing: Story = () => (
  <Frame label="Client address never recorded">
    <BookingLocationCallout view={resolveStaffBookingLocation({ location_type: 'client_address' })} />
  </Frame>
);

export const ClientAddressHidden: Story = () => (
  <Frame label="Client address hidden by linked-venue permissions">
    <BookingLocationCallout
      view={resolveStaffBookingLocation({ location_type: 'client_address', addressHidden: true })}
    />
  </Frame>
);

export const Online: Story = () => (
  <Frame label="Online with link and joining information">
    <BookingLocationCallout
      view={resolveStaffBookingLocation({
        location_type: 'online',
        online_meeting_url: 'https://zoom.us/j/98765432101?pwd=example',
        online_meeting_info: 'Join a few minutes early. Camera on please, and have your notes to hand.',
      })}
    />
  </Frame>
);

export const OnlineDense: Story = () => (
  <Frame label="Online, dense (popover)">
    <BookingLocationCallout
      view={resolveStaffBookingLocation({
        location_type: 'online',
        online_meeting_url: 'https://zoom.us/j/98765432101?pwd=example',
        online_meeting_info: 'Join a few minutes early.',
      })}
      dense
    />
  </Frame>
);

export const OnlineNoLink: Story = () => (
  <Frame label="Online with no link configured">
    <BookingLocationCallout view={resolveStaffBookingLocation({ location_type: 'online' })} />
  </Frame>
);

export const BusinessVenueRendersNothing: Story = () => (
  <Frame label="Business venue renders nothing at all">
    <BookingLocationCallout view={resolveStaffBookingLocation({ location_type: 'business_venue' })} />
  </Frame>
);
