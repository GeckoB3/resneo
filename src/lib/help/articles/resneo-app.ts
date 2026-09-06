import type { HelpCategory } from '../types';
import { article as installAndSignIn } from './resneo-app/install-and-sign-in';
import { article as diaryOnYourPhone } from './resneo-app/diary-on-your-phone';
import { article as bookingsInTheApp } from './resneo-app/bookings-in-the-app';
import { article as takeABookingInTheApp } from './resneo-app/take-a-booking-in-the-app';
import { article as clientsInTheApp } from './resneo-app/clients-in-the-app';
import { article as availabilityInTheApp } from './resneo-app/availability-in-the-app';
import { article as paymentsInTheApp } from './resneo-app/payments-in-the-app';
import { article as complianceInTheApp } from './resneo-app/compliance-in-the-app';
import { article as pushNotificationsAndSecurity } from './resneo-app/push-notifications-and-security';
import { article as venueSettingsInTheApp } from './resneo-app/venue-settings-in-the-app';
import { article as webOnlyFeatures } from './resneo-app/web-only-features';

export const resneoAppCategory: HelpCategory = {
  slug: 'resneo-app',
  title: 'The ResNeo app',
  description:
    "Run your venue from your phone: install the app and sign in, work your diary on the move, take bookings and payments at the counter, keep client records and compliance forms up to date, and know which jobs still belong on the web.",
  plan: 'all',
  articles: [installAndSignIn, diaryOnYourPhone, bookingsInTheApp, takeABookingInTheApp, clientsInTheApp, availabilityInTheApp, paymentsInTheApp, complianceInTheApp, pushNotificationsAndSecurity, venueSettingsInTheApp, webOnlyFeatures],
};
