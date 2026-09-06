import type { HelpCategory } from '../types';
import { article as welcome } from './getting-started/welcome';
import { article as signingIn } from './getting-started/signing-in';
import { article as dashboardOverview } from './getting-started/dashboard-overview';
import { article as setupChecklist } from './getting-started/setup-checklist';
import { article as businessProfile } from './getting-started/business-profile';
import { article as businessAndCalendarHours } from './getting-started/business-and-calendar-hours';
import { article as stripePayments } from './getting-started/stripe-payments';
import { article as publicBookingPage } from './getting-started/public-booking-page';
import { article as whatYourClientsSee } from './getting-started/what-your-clients-see';
import { article as optionalBookingFeatures } from './getting-started/optional-booking-features';
import { article as staffFirstBooking } from './getting-started/staff-first-booking';
import { article as staff } from './getting-started/staff';
import { article as services } from './getting-started/services';
import { article as classes } from './getting-started/classes';
import { article as events } from './getting-started/events';
import { article as resources } from './getting-started/resources';
import { article as calendar } from './getting-started/calendar';
import { article as bookingsList } from './getting-started/bookings-list';
import { article as newBooking } from './getting-started/new-booking';
import { article as contacts } from './getting-started/contacts';
import { article as yourClientsResneoAccount } from './getting-started/your-clients-resneo-account';
import { article as waitlist } from './getting-started/waitlist';
import { article as compliance } from './getting-started/compliance';
import { article as communications } from './getting-started/communications';
import { article as reports } from './getting-started/reports';
import { article as importingData } from './getting-started/importing-data';
import { article as referAndEarn } from './getting-started/refer-and-earn';
import { article as linkedVenues } from './getting-started/linked-venues';

export const gettingStartedCategory: HelpCategory = {
  slug: 'getting-started',
  title: 'Getting started',
  description:
    "Everything you need to set up and run ResNeo for your appointments business: your profile, hours, payments, booking page, services, classes, events, resources, your team, the daily tools, communications, reports, and more, all in plain language.",
  plan: 'all',
  articles: [welcome, signingIn, dashboardOverview, setupChecklist, businessProfile, businessAndCalendarHours, stripePayments, publicBookingPage, whatYourClientsSee, optionalBookingFeatures, staffFirstBooking, staff, services, classes, events, resources, calendar, bookingsList, newBooking, contacts, yourClientsResneoAccount, waitlist, compliance, communications, reports, importingData, referAndEarn, linkedVenues],
};
