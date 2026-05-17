/** Shared types for the cross-venue linked-calendar view (§8.2). */

import type { LinkGrant } from './types';

export interface LinkedPractitioner {
  id: string;
  name: string;
  isActive: boolean;
}

export interface LinkedBooking {
  id: string;
  practitionerId: string | null;
  bookingDate: string;
  bookingTime: string;
  bookingEndTime: string | null;
  status: string;
  /** Present only when the viewer has full_details access. */
  guestName: string | null;
  serviceName: string | null;
  /** True when the viewer's grant allows editing this booking. */
  editable: boolean;
}

export interface LinkedVenueCalendar {
  venueId: string;
  venueName: string;
  linkId: string;
  /** Calendar visibility into this venue: 'time_only' | 'full_details'. */
  visibility: LinkGrant['calendar'];
  /** Action level the viewer holds over this venue's bookings. */
  action: LinkGrant['act'];
  practitioners: LinkedPractitioner[];
  bookings: LinkedBooking[];
}
