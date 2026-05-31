import { describe, expect, it } from 'vitest';
import {
  bookingPageHasExtraTabs,
  bookingPageHideAboutTabContentFromHeader,
  resolveBookingPageTabs,
  resolveBookingPageTeamMembers,
} from '@/lib/booking/booking-page-tabs';

describe('booking page tabs', () => {
  it('returns only Book now for table venues', () => {
    expect(resolveBookingPageTabs({ show_services_tab: true }, 'table_reservation')).toEqual(['book']);
    expect(bookingPageHasExtraTabs({ show_team_tab: true }, 'table_reservation')).toBe(false);
  });

  it('adds Services, Meet the team, and About for appointment venues', () => {
    const config = { show_services_tab: true, show_team_tab: true, show_about_tab: true };
    expect(resolveBookingPageTabs(config, 'unified_scheduling')).toEqual(['book', 'services', 'team', 'about']);
    expect(bookingPageHasExtraTabs(config, 'unified_scheduling')).toBe(true);
  });

  it('shows only Book now when booking page config is empty (new venue defaults)', () => {
    expect(resolveBookingPageTabs({}, 'unified_scheduling')).toEqual(['book']);
    expect(bookingPageHasExtraTabs({}, 'unified_scheduling')).toBe(false);
  });

  it('omits About when show_about_tab is false', () => {
    expect(resolveBookingPageTabs({ show_about_tab: false }, 'unified_scheduling')).toEqual(['book']);
    expect(bookingPageHasExtraTabs({ show_about_tab: false }, 'unified_scheduling')).toBe(false);
  });

  it('hides About-tab header content for appointment venues with tabs or About off', () => {
    expect(
      bookingPageHideAboutTabContentFromHeader(
        { show_services_tab: true, show_about_tab: false },
        'unified_scheduling',
      ),
    ).toBe(true);
    expect(
      bookingPageHideAboutTabContentFromHeader({ show_about_tab: true }, 'unified_scheduling'),
    ).toBe(true);
    expect(bookingPageHideAboutTabContentFromHeader({}, 'table_reservation')).toBe(false);
  });

  it('omits Services and Meet the team when tab flags are off', () => {
    expect(
      resolveBookingPageTabs(
        { show_services_tab: false, show_team_tab: false, show_about_tab: false },
        'unified_scheduling',
      ),
    ).toEqual(['book']);
  });

  it('filters team members with visible profiles', () => {
    const members = resolveBookingPageTeamMembers(
      [
        { id: 'a', name: 'Alex' },
        { id: 'b', name: 'Bea' },
      ],
      {
        a: { bio: 'Stylist', hidden: false },
        b: { hidden: true, bio: 'Hidden' },
      },
    );
    expect(members).toHaveLength(1);
    expect(members[0]?.name).toBe('Alex');
  });
});
