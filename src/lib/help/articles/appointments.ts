import type { HelpCategory } from '../types';
import { article as overview } from './appointments/overview';
import { article as calendarSetup } from './appointments/calendar-setup';
import { article as services } from './appointments/services';
import { article as workingHours } from './appointments/working-hours';
import { article as appointmentCalendar } from './appointments/appointment-calendar';
import { article as managingAppointments } from './appointments/managing-appointments';
import { article as classes } from './appointments/classes';
import { article as sellingClassPacks } from './appointments/selling-class-packs';
import { article as buildingAClassCourse } from './appointments/building-a-class-course';
import { article as sellingMemberships } from './appointments/selling-memberships';
import { article as events } from './appointments/events';
import { article as resources } from './appointments/resources';
import { article as teamManagement } from './appointments/team-management';
import { article as deposits } from './appointments/deposits';
import { article as communications } from './appointments/communications';
import { article as reports } from './appointments/reports';
import { article as dataImport } from './appointments/data-import';
import { article as bookingWidget } from './appointments/booking-widget';

export const appointmentsCategory: HelpCategory = {
  slug: 'appointments',
  title: 'Appointments plan',
  description:
    'Everything you need for Appointments Light, Plus, and Pro: calendars, services, availability, the appointment calendar, classes, events, resources, team access, payments, communications, reports, import, and your public booking experience.',
  plan: 'appointments',
  articles: [overview, calendarSetup, services, workingHours, appointmentCalendar, managingAppointments, classes, sellingClassPacks, buildingAClassCourse, sellingMemberships, events, resources, teamManagement, deposits, communications, reports, dataImport, bookingWidget],
};
