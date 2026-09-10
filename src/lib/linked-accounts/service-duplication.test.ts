import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import { ppdPatchTestTemplate } from '@/lib/compliance/library/templates/ppd-patch-test';

vi.mock('./catalogue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./catalogue')>()),
  loadVenueCatalogueData: vi.fn(),
}));

import { loadVenueCatalogueData } from './catalogue';
import { ensureServiceForCalendar, loadOfferingTemplate, matchAddonGroupsToOrigin } from './service-duplication';

const mockCatalogue = vi.mocked(loadVenueCatalogueData);

const COLLECTIVE = 'collective-1';
const HOST = 'venue-host';
const MEMBER_A = 'venue-a';
const MEMBER_B = 'venue-b';
const ITEM = 'item-cut';
const HOST_SERVICE = 'svc-host-cut';
const A_SERVICE = 'svc-a-cut';
const HOST_CATEGORY = 'cat-host-hair';
const HOST_GROUP = 'grp-host-finish';
const HOST_TYPE = 'type-host-ppd';
const HOST_VERSION = 'ver-host-ppd';
const CAL_B = 'cal-b';

const BLOCK_EARLY = { id: '11111111-1111-4111-8111-111111111111', start_minute: 10, duration_minutes: 15 };
const BLOCK_LATE = { id: '22222222-2222-4222-8222-222222222222', start_minute: 40, duration_minutes: 15 };

type Row = Record<string, unknown>;

/** The host's fully configured service, the way its Services page can set it up. */
function hostServiceRow(overrides: Row = {}): Row {
  return {
    id: HOST_SERVICE,
    venue_id: HOST,
    name: 'Cut and colour',
    description: 'Full head colour with a finishing cut.',
    item_type: 'service',
    duration_minutes: 60,
    buffer_minutes: 10,
    processing_time_minutes: 0,
    processing_time_blocks: [BLOCK_EARLY, BLOCK_LATE],
    price_pence: 8500,
    deposit_pence: 2000,
    payment_requirement: 'deposit',
    price_type: 'fixed',
    capacity_per_session: null,
    pre_appointment_instructions: 'Arrive with dry hair.',
    colour: '#AA00AA',
    sort_order: 7,
    is_active: true,
    is_bookable_online: false,
    staff_may_customize_name: false,
    staff_may_customize_description: false,
    staff_may_customize_duration: true,
    staff_may_customize_buffer: false,
    staff_may_customize_price: true,
    staff_may_customize_deposit: false,
    staff_may_customize_colour: false,
    custom_availability_enabled: true,
    custom_working_hours: { monday: [{ start: '10:00', end: '16:00' }] },
    max_advance_booking_days: 45,
    min_booking_notice_hours: 6,
    cancellation_notice_hours: 24,
    allow_same_day_booking: false,
    booking_interval_minutes: 30,
    booking_minute_marks: [0, 30],
    booking_start_times: ['10:00', '13:00'],
    location_type: 'online',
    online_meeting_url: 'https://meet.example/cut',
    online_meeting_info: 'Link sent the day before.',
    category_id: HOST_CATEGORY,
    created_by_staff_id: 'staff-host-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

function seedDb(opts: { offering?: Row; hostService?: Row; targetExtra?: Record<string, Row[]> } = {}) {
  return new FakeSupabase({
    venue_collectives: [{ id: COLLECTIVE, host_venue_id: HOST }],
    collective_service_items: [
      {
        id: ITEM,
        collective_id: COLLECTIVE,
        name: 'Cut and colour',
        default_duration_minutes: null,
        default_price_pence: null,
        category_id: 'ccat-colour',
        ...(opts.offering ?? {}),
      },
    ],
    collective_service_categories: [{ id: 'ccat-colour', collective_id: COLLECTIVE, name: 'Colour services' }],
    // Member A joined the offering first; the host's own service must still be the origin.
    collective_service_providers: [
      {
        id: 'prov-a',
        item_id: ITEM,
        venue_id: MEMBER_A,
        source_service_id: A_SERVICE,
        status: 'active',
        created_at: '2026-03-01T00:00:00Z',
      },
      {
        id: 'prov-host',
        item_id: ITEM,
        venue_id: HOST,
        source_service_id: HOST_SERVICE,
        status: 'active',
        created_at: '2026-03-02T00:00:00Z',
      },
    ],
    service_items: [
      opts.hostService ?? hostServiceRow(),
      { id: A_SERVICE, venue_id: MEMBER_A, name: 'Cut and colour', duration_minutes: 45, processing_time_blocks: [] },
      // Member B has ordered its list, so the copy is appended after its last service.
      { id: 'svc-b-other', venue_id: MEMBER_B, name: 'Blow dry', duration_minutes: 30, sort_order: 3 },
      ...(opts.targetExtra?.service_items ?? []),
    ],
    service_categories: [
      { id: HOST_CATEGORY, venue_id: HOST, name: 'Hair', sort_order: 0 },
      ...(opts.targetExtra?.service_categories ?? []),
    ],
    service_variants: [
      {
        id: 'var-1',
        venue_id: HOST,
        service_item_id: HOST_SERVICE,
        appointment_service_id: null,
        name: 'Short hair',
        description: null,
        duration_minutes: 60,
        buffer_minutes: 5,
        price_pence: 8500,
        deposit_pence: 2000,
        sort_order: 0,
        is_active: true,
        processing_time_blocks: [BLOCK_EARLY],
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'var-2',
        venue_id: HOST,
        service_item_id: HOST_SERVICE,
        appointment_service_id: null,
        name: 'Long hair',
        description: 'Below the shoulder.',
        duration_minutes: 90,
        buffer_minutes: 10,
        price_pence: 11000,
        deposit_pence: 3000,
        sort_order: 1,
        is_active: false,
        processing_time_blocks: [BLOCK_EARLY, BLOCK_LATE],
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    addon_groups: [
      {
        id: HOST_GROUP,
        venue_id: HOST,
        name: 'Finish',
        prompt_to_client: 'How would you like it finished?',
        description: null,
        selection_type: 'single',
        min_select: 0,
        max_select: 1,
        hidden_from_online: false,
        is_active: true,
        sort_order: 2,
      },
      ...(opts.targetExtra?.addon_groups ?? []),
    ],
    addons: [
      {
        id: 'addon-1',
        addon_group_id: HOST_GROUP,
        venue_id: HOST,
        name: 'Blow dry',
        description: null,
        additional_price_pence: 1500,
        additional_duration_minutes: 20,
        cost_to_business_pence: 300,
        is_active: true,
        sort_order: 0,
        archived_at: null,
      },
      {
        id: 'addon-2',
        addon_group_id: HOST_GROUP,
        venue_id: HOST,
        name: 'Straighten',
        description: 'Flat iron finish.',
        additional_price_pence: 1000,
        additional_duration_minutes: 15,
        cost_to_business_pence: null,
        is_active: true,
        sort_order: 1,
        archived_at: null,
      },
      {
        id: 'addon-old',
        addon_group_id: HOST_GROUP,
        venue_id: HOST,
        name: 'Retired option',
        additional_price_pence: 0,
        additional_duration_minutes: 0,
        is_active: false,
        sort_order: 2,
        archived_at: '2026-05-01T00:00:00Z',
      },
      ...(opts.targetExtra?.addons ?? []),
    ],
    service_addon_groups: [
      { id: 'link-1', venue_id: HOST, service_item_id: HOST_SERVICE, addon_group_id: HOST_GROUP, sort_order: 0 },
    ],
    compliance_types: [
      {
        id: HOST_TYPE,
        venue_id: HOST,
        name: 'PPD Patch Test',
        slug: 'ppd-patch-test',
        category: 'test',
        description: 'Allergy alert test.',
        result_type: 'pass_fail',
        validity_period_days: 180,
        capture_methods: ['staff_in_venue'],
        current_version_id: HOST_VERSION,
        library_template_slug: 'ppd-patch-test',
        form_link_expiry_days: 14,
        online_unmet_message: 'Book a patch test first.',
        is_active: true,
        archived_at: null,
      },
      ...(opts.targetExtra?.compliance_types ?? []),
    ],
    compliance_type_versions: [
      {
        id: HOST_VERSION,
        venue_id: HOST,
        compliance_type_id: HOST_TYPE,
        version_number: 1,
        form_schema: ppdPatchTestTemplate.form_schema,
      },
    ],
    service_compliance_requirements: [
      {
        id: 'req-1',
        venue_id: HOST,
        service_item_id: HOST_SERVICE,
        appointment_service_id: null,
        compliance_type_id: HOST_TYPE,
        enforcement: 'block_online',
        lock_period_hours: 48,
        online_collection: 'inline',
        scope: 'service',
      },
    ],
    ...(opts.targetExtra
      ? Object.fromEntries(
          Object.entries(opts.targetExtra).filter(
            ([t]) => !['service_items', 'service_categories', 'addon_groups', 'addons', 'compliance_types'].includes(t),
          ),
        )
      : {}),
  });
}

/** Member B's catalogue as the builder sees it: one calendar, no same-named service. */
function targetCatalogue(services: Array<{ id: string; name: string; calendars: string[] }> = []) {
  return {
    services: new Map(
      services.map((s) => [
        s.id,
        { name: s.name, durationMinutes: 30, pricePence: null, description: null, sortOrder: 0, category: null },
      ]),
    ),
    calendars: new Map([[CAL_B, { name: 'Chair B' }]]),
    serviceCalendars: new Map(services.map((s) => [s.id, s.calendars])),
    serviceList: [],
    calendarList: [{ id: CAL_B, name: 'Chair B' }],
  };
}

const rowsFor = (db: FakeSupabase, table: string, venueId: string) =>
  (db.tables[table] ?? []).filter((r) => r.venue_id === venueId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadOfferingTemplate', () => {
  it("takes the host's own service as the origin and carries every column except identity", async () => {
    const db = seedDb();
    const tpl = await loadOfferingTemplate(db.asClient(), ITEM);
    expect(tpl).not.toBeNull();
    expect(tpl!.origin).toEqual({ venueId: HOST, serviceId: HOST_SERVICE });
    expect(tpl!.name).toBe('Cut and colour');
    expect(tpl!.durationMinutes).toBe(60);
    expect(tpl!.pricePence).toBe(8500);

    // Everything the Services page can set travels with the copy...
    expect(tpl!.columns).toMatchObject({
      description: 'Full head colour with a finishing cut.',
      buffer_minutes: 10,
      processing_time_blocks: [BLOCK_EARLY, BLOCK_LATE],
      deposit_pence: 2000,
      payment_requirement: 'deposit',
      pre_appointment_instructions: 'Arrive with dry hair.',
      colour: '#AA00AA',
      is_bookable_online: false,
      staff_may_customize_duration: true,
      staff_may_customize_price: true,
      custom_availability_enabled: true,
      custom_working_hours: { monday: [{ start: '10:00', end: '16:00' }] },
      max_advance_booking_days: 45,
      min_booking_notice_hours: 6,
      cancellation_notice_hours: 24,
      allow_same_day_booking: false,
      booking_interval_minutes: 30,
      booking_minute_marks: [0, 30],
      booking_start_times: ['10:00', '13:00'],
      location_type: 'online',
      online_meeting_url: 'https://meet.example/cut',
      online_meeting_info: 'Link sent the day before.',
    });
    // ...except what belongs to the origin row itself.
    for (const key of [
      'id',
      'venue_id',
      'name',
      'duration_minutes',
      'price_pence',
      'is_active',
      'sort_order',
      'category_id',
      'created_by_staff_id',
      'created_at',
      'updated_at',
    ]) {
      expect(tpl!.columns).not.toHaveProperty(key);
    }

    expect(tpl!.categoryName).toBe('Hair');
    expect(tpl!.variants.map((v) => v.name)).toEqual(['Short hair', 'Long hair']);
    expect(tpl!.variants[1]).toMatchObject({ is_active: false, processing_time_blocks: [BLOCK_EARLY, BLOCK_LATE] });
    expect(tpl!.variants[0]).not.toHaveProperty('service_item_id');
    expect(tpl!.addonGroups).toHaveLength(1);
    expect(tpl!.addonGroups[0]!.group).toMatchObject({ name: 'Finish', selection_type: 'single', max_select: 1 });
    // Archived options stay behind; live ones come along in order.
    expect(tpl!.addonGroups[0]!.addons.map((a) => a.name)).toEqual(['Blow dry', 'Straighten']);
    expect(tpl!.complianceRequirements).toHaveLength(1);
    expect(tpl!.complianceRequirements[0]!.requirement).toMatchObject({
      enforcement: 'block_online',
      lock_period_hours: 48,
      online_collection: 'inline',
    });
    expect(tpl!.complianceRequirements[0]!.formSchema).toEqual(ppdPatchTestTemplate.form_schema);
  });

  it("falls back to the offering's own heading when the origin has no category", async () => {
    const db = seedDb({ hostService: hostServiceRow({ category_id: null }) });
    const tpl = await loadOfferingTemplate(db.asClient(), ITEM);
    expect(tpl!.categoryName).toBe('Colour services');
  });

  it("prefers the offering's default duration and drops processing gaps that no longer fit", async () => {
    const db = seedDb({ offering: { default_duration_minutes: 30, default_price_pence: 6000 } });
    const tpl = await loadOfferingTemplate(db.asClient(), ITEM);
    expect(tpl!.durationMinutes).toBe(30);
    expect(tpl!.pricePence).toBe(6000);
    expect(tpl!.columns.processing_time_blocks).toEqual([BLOCK_EARLY]);
  });

  it('returns null for an unknown offering', async () => {
    expect(await loadOfferingTemplate(seedDb().asClient(), 'nope')).toBeNull();
  });
});

describe('ensureServiceForCalendar', () => {
  it('creates an exact copy in the member venue: columns, heading, variants, add-ons, compliance', async () => {
    const db = seedDb();
    const admin = db.asClient();
    mockCatalogue.mockResolvedValue(targetCatalogue() as never);
    const template = await loadOfferingTemplate(admin, ITEM);

    const res = await ensureServiceForCalendar(admin, {
      targetVenueId: MEMBER_B,
      targetCalendarId: CAL_B,
      offeringName: template!.name,
      template,
    });
    expect(res).toMatchObject({ created: true });
    const newId = (res as { sourceServiceId: string }).sourceServiceId;

    const copy = db.tables.service_items!.find((r) => r.id === newId)!;
    const origin = hostServiceRow();
    expect(copy).toMatchObject({
      venue_id: MEMBER_B,
      name: 'Cut and colour',
      duration_minutes: 60,
      price_pence: 8500,
      is_active: true,
      created_by_staff_id: null,
      sort_order: 4, // appended after Member B's last ordered service
    });
    // Every copied column matches the origin exactly.
    for (const [key, value] of Object.entries(origin)) {
      if (['id', 'venue_id', 'sort_order', 'category_id', 'created_by_staff_id', 'created_at', 'updated_at'].includes(key)) continue;
      expect(copy[key], key).toEqual(value);
    }

    // The heading is created at Member B and the copy filed under it.
    const bCategories = rowsFor(db, 'service_categories', MEMBER_B);
    expect(bCategories.map((c) => c.name)).toEqual(['Hair']);
    expect(copy.category_id).toBe(bCategories[0]!.id);

    // Variants, including the inactive one and their processing gaps.
    const bVariants = rowsFor(db, 'service_variants', MEMBER_B);
    expect(bVariants).toHaveLength(2);
    expect(bVariants.every((v) => v.service_item_id === newId)).toBe(true);
    expect(bVariants.map((v) => [v.name, v.duration_minutes, v.price_pence, v.is_active])).toEqual([
      ['Short hair', 60, 8500, true],
      ['Long hair', 90, 11000, false],
    ]);
    expect(bVariants[1]!.processing_time_blocks).toEqual([BLOCK_EARLY, BLOCK_LATE]);

    // The add-on group is re-created at Member B with its live options and linked.
    const bGroups = rowsFor(db, 'addon_groups', MEMBER_B);
    expect(bGroups).toHaveLength(1);
    expect(bGroups[0]).toMatchObject({ name: 'Finish', selection_type: 'single', prompt_to_client: 'How would you like it finished?' });
    const bAddons = rowsFor(db, 'addons', MEMBER_B);
    expect(bAddons.map((a) => [a.name, a.additional_price_pence, a.additional_duration_minutes])).toEqual([
      ['Blow dry', 1500, 20],
      ['Straighten', 1000, 15],
    ]);
    expect(bAddons.every((a) => a.addon_group_id === bGroups[0]!.id)).toBe(true);
    expect(rowsFor(db, 'service_addon_groups', MEMBER_B)).toEqual([
      expect.objectContaining({ service_item_id: newId, addon_group_id: bGroups[0]!.id, sort_order: 0 }),
    ]);

    // The compliance type is created at Member B (with its form) and the requirement re-attached.
    const bTypes = rowsFor(db, 'compliance_types', MEMBER_B);
    expect(bTypes).toHaveLength(1);
    expect(bTypes[0]).toMatchObject({
      name: 'PPD Patch Test',
      library_template_slug: 'ppd-patch-test',
      validity_period_days: 180,
      online_unmet_message: 'Book a patch test first.',
    });
    const bVersions = rowsFor(db, 'compliance_type_versions', MEMBER_B);
    expect(bVersions).toHaveLength(1);
    expect(bVersions[0]).toMatchObject({ compliance_type_id: bTypes[0]!.id, form_schema: ppdPatchTestTemplate.form_schema });
    expect(bTypes[0]!.current_version_id).toBe(bVersions[0]!.id);
    expect(rowsFor(db, 'service_compliance_requirements', MEMBER_B)).toEqual([
      expect.objectContaining({
        service_item_id: newId,
        compliance_type_id: bTypes[0]!.id,
        enforcement: 'block_online',
        lock_period_hours: 48,
        online_collection: 'inline',
        scope: 'service',
      }),
    ]);
    // Nobody at Member B did this, so the audit trail says so.
    expect(rowsFor(db, 'compliance_audit_events', MEMBER_B).every((e) => e.actor_type === 'system')).toBe(true);

    // And the calendar is linked to the copy.
    expect(db.tables.calendar_service_assignments).toEqual([
      expect.objectContaining({ calendar_id: CAL_B, service_item_id: newId }),
    ]);
  });

  it('reuses a matching heading, add-on group and compliance type the member venue already has', async () => {
    const db = seedDb({
      targetExtra: {
        service_categories: [{ id: 'cat-b-hair', venue_id: MEMBER_B, name: 'hair', sort_order: 0 }],
        addon_groups: [
          { id: 'grp-b-finish', venue_id: MEMBER_B, name: 'Finish', selection_type: 'single', is_active: true },
          // Same name, different options: not the same group.
          { id: 'grp-b-other', venue_id: MEMBER_B, name: 'Finish', selection_type: 'single', is_active: true },
        ],
        addons: [
          // Same options as the origin's, price and length included, so the group is reused.
          { id: 'b-addon-1', addon_group_id: 'grp-b-finish', venue_id: MEMBER_B, name: 'Straighten', additional_price_pence: 1000, additional_duration_minutes: 15, archived_at: null },
          { id: 'b-addon-2', addon_group_id: 'grp-b-finish', venue_id: MEMBER_B, name: 'blow dry', additional_price_pence: 1500, additional_duration_minutes: 20, archived_at: null },
          { id: 'b-addon-3', addon_group_id: 'grp-b-other', venue_id: MEMBER_B, name: 'Curl', archived_at: null },
        ],
        compliance_types: [
          {
            id: 'type-b-ppd',
            venue_id: MEMBER_B,
            name: 'Patch test (our wording)',
            library_template_slug: 'ppd-patch-test',
            is_active: true,
            archived_at: null,
          },
        ],
      },
    });
    const admin = db.asClient();
    mockCatalogue.mockResolvedValue(targetCatalogue() as never);
    const template = await loadOfferingTemplate(admin, ITEM);

    const res = await ensureServiceForCalendar(admin, {
      targetVenueId: MEMBER_B,
      targetCalendarId: CAL_B,
      offeringName: template!.name,
      template,
    });
    expect(res).toMatchObject({ created: true });
    const newId = (res as { sourceServiceId: string }).sourceServiceId;

    expect(rowsFor(db, 'service_categories', MEMBER_B)).toHaveLength(1);
    expect(db.tables.service_items!.find((r) => r.id === newId)!.category_id).toBe('cat-b-hair');
    expect(rowsFor(db, 'addon_groups', MEMBER_B).map((g) => g.id)).toEqual(['grp-b-finish', 'grp-b-other']);
    expect(rowsFor(db, 'service_addon_groups', MEMBER_B)).toEqual([
      expect.objectContaining({ service_item_id: newId, addon_group_id: 'grp-b-finish' }),
    ]);
    expect(rowsFor(db, 'compliance_types', MEMBER_B).map((t) => t.id)).toEqual(['type-b-ppd']);
    expect(rowsFor(db, 'service_compliance_requirements', MEMBER_B)).toEqual([
      expect.objectContaining({ service_item_id: newId, compliance_type_id: 'type-b-ppd', enforcement: 'block_online' }),
    ]);
  });

  it('matchAddonGroupsToOrigin leaves the copy linked to exactly the origin’s groups', async () => {
    const db = seedDb({
      targetExtra: {
        service_items: [{ id: 'svc-b-existing', venue_id: MEMBER_B, name: 'Cut and colour', is_active: true }],
        addon_groups: [
          { id: 'grp-b-finish', venue_id: MEMBER_B, name: 'Finish', selection_type: 'single', is_active: true },
          { id: 'grp-b-extra', venue_id: MEMBER_B, name: 'Treatments', selection_type: 'multi', is_active: true },
        ],
        addons: [
          { id: 'b-addon-1', addon_group_id: 'grp-b-finish', venue_id: MEMBER_B, name: 'Straighten', additional_price_pence: 1000, additional_duration_minutes: 15, archived_at: null },
          { id: 'b-addon-2', addon_group_id: 'grp-b-finish', venue_id: MEMBER_B, name: 'Blow dry', additional_price_pence: 1500, additional_duration_minutes: 20, archived_at: null },
          { id: 'b-addon-9', addon_group_id: 'grp-b-extra', venue_id: MEMBER_B, name: 'Olaplex', additional_price_pence: 2000, additional_duration_minutes: 10, archived_at: null },
        ],
      },
    });
    // The copy links to a matching group and to one the origin does not have.
    db.tables.service_addon_groups!.push(
      { id: 'b-link-1', venue_id: MEMBER_B, service_item_id: 'svc-b-existing', addon_group_id: 'grp-b-finish', sort_order: 0 },
      { id: 'b-link-2', venue_id: MEMBER_B, service_item_id: 'svc-b-existing', addon_group_id: 'grp-b-extra', sort_order: 1 },
    );
    const admin = db.asClient();
    const template = await loadOfferingTemplate(admin, ITEM);

    expect(await matchAddonGroupsToOrigin(admin, MEMBER_B, 'svc-b-existing', template!.addonGroups)).toBe(true);

    // Linked to the matching group only; the extra group is unlinked but still exists.
    expect(rowsFor(db, 'service_addon_groups', MEMBER_B).map((l) => l.addon_group_id)).toEqual(['grp-b-finish']);
    expect(rowsFor(db, 'addon_groups', MEMBER_B).map((g) => g.id)).toEqual(['grp-b-finish', 'grp-b-extra']);
  });

  it('removes the partial copy and reports the step when part of it cannot be written', async () => {
    const db = seedDb();
    const admin = db.asClient();
    mockCatalogue.mockResolvedValue(targetCatalogue() as never);
    const template = await loadOfferingTemplate(admin, ITEM);
    // The group is created, then linking it fails.
    db['failNextInsert' as keyof FakeSupabase] = { service_addon_groups: { message: 'boom' } } as never;

    const res = await ensureServiceForCalendar(admin, {
      targetVenueId: MEMBER_B,
      targetCalendarId: CAL_B,
      offeringName: template!.name,
      template,
    });
    expect(res).toEqual({ error: "Failed to copy the service's add-ons." });
    expect(rowsFor(db, 'service_items', MEMBER_B).map((r) => r.name)).toEqual(['Blow dry']);
    expect(rowsFor(db, 'addon_groups', MEMBER_B)).toEqual([]);
    expect(db.tables.calendar_service_assignments ?? []).toEqual([]);
  });

  it('only links the calendar when the member venue already has a same-named service', async () => {
    const db = seedDb();
    const admin = db.asClient();
    mockCatalogue.mockResolvedValue(
      targetCatalogue([{ id: 'svc-b-cut', name: 'Cut and Colour (60 min)', calendars: ['cal-b-other'] }]) as never,
    );
    const template = await loadOfferingTemplate(admin, ITEM);
    const before = db.tables.service_items!.length;

    const res = await ensureServiceForCalendar(admin, {
      targetVenueId: MEMBER_B,
      targetCalendarId: CAL_B,
      offeringName: template!.name,
      template,
    });
    expect(res).toEqual({ sourceServiceId: 'svc-b-cut', created: false });
    expect(db.tables.service_items).toHaveLength(before);
    expect(db.tables.calendar_service_assignments).toEqual([
      expect.objectContaining({ calendar_id: CAL_B, service_item_id: 'svc-b-cut' }),
    ]);
  });

  it('creates a plain service when the offering has no provider left to copy from', async () => {
    const db = seedDb();
    db.tables.collective_service_providers = [];
    const admin = db.asClient();
    mockCatalogue.mockResolvedValue(targetCatalogue() as never);
    const template = await loadOfferingTemplate(admin, ITEM);
    expect(template!.origin).toBeNull();

    const res = await ensureServiceForCalendar(admin, {
      targetVenueId: MEMBER_B,
      targetCalendarId: CAL_B,
      offeringName: template!.name,
      template,
    });
    expect(res).toMatchObject({ created: true });
    const copy = db.tables.service_items!.find((r) => r.id === (res as { sourceServiceId: string }).sourceServiceId)!;
    expect(copy).toMatchObject({ venue_id: MEMBER_B, duration_minutes: 30, price_pence: null, item_type: 'service' });
    // The offering's own heading still applies.
    expect(rowsFor(db, 'service_categories', MEMBER_B).map((c) => c.name)).toEqual(['Colour services']);
  });
});
