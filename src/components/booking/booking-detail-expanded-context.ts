import type { Dispatch, SetStateAction } from 'react';
import type { BookingStatus } from '@/lib/table-management/booking-status';
import type { BookingDetail, AssignmentSuggestion } from '@/app/dashboard/bookings/booking-detail-panel-model';
import type { buildBookingForExpanded, buildDetailForExpanded } from '@/components/booking/booking-detail-expanded-payload';

export interface BookingDetailExpandedContext {
  bookingForExpanded: ReturnType<typeof buildBookingForExpanded>;
  detailForExpanded: ReturnType<typeof buildDetailForExpanded>;
  isHydrated: boolean;
  tableManagementEnabled: boolean;
  venueId: string;
  venueCurrency: string;
  customMessage: string;
  actionLoading: boolean;
  setCustomMessage: Dispatch<SetStateAction<string>>;
  setActionLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  bookingId: string;
  load: () => Promise<void>;
  d: BookingDetail;
  executeStatusChange: (status: BookingStatus) => Promise<void>;
  onUpdated: () => void;
  bookingStyleIsTable: boolean;
  showAssignModal: boolean;
  setShowAssignModal: Dispatch<SetStateAction<boolean>>;
  suggestionsLoading: boolean;
  assignmentSuggestions: AssignmentSuggestion[];
  assignedTables: Array<{ id: string; name: string }>;
  allTables: Array<{ id: string; name: string; max_covers: number }>;
  recommendedTableIds: string[];
  venueTimezone: string;
  guestHistoryListRefresh: number;
  stackDepth: number;
  setNestedBookingOpen: Dispatch<
    SetStateAction<{
      id: string;
      snapshot: import('@/app/dashboard/bookings/booking-detail-panel-snapshot').BookingDetailPanelSnapshot;
      isAppointment: boolean;
    } | null>
  >;
}
