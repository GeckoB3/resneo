import { redirect } from 'next/navigation';

/**
 * The standalone linked-calendars page is folded into the diary (plan §6.17, W21): partner columns
 * sit beside the venue's own there, drawn from the same feed and the same resolved hours, so there
 * is one cross-venue diary rather than two that could disagree. Old bookmarks land on the diary.
 */
export default function LinkedCalendarPage() {
  redirect('/dashboard/calendar');
}
