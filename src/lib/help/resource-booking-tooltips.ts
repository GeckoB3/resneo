/** Helper copy for resource slot interval and min booking fields (dashboard + onboarding). */

export const RESOURCE_SLOT_INTERVAL_HELP =
  'How often a guest may start a booking: start times move forward in steps of this many minutes from the beginning of each open period (e.g. 60 = on the hour only; 30 = on the hour and :30). This is not extra buffer after a booking ends, if a session ends between grid times, that gap can stay empty until the next allowed start. Online pricing uses the same step: total price = (price per step) × (booking length ÷ this many minutes).';

export const RESOURCE_MIN_BOOKING_HELP =
  'Shortest session length you allow for availability checks. By default it matches the start-time step; use “Advanced” only when you want a finer grid but a longer minimum (e.g. start every 15 minutes, book at least 60). Guest duration choices increase from this value in steps of the start-time step.';
