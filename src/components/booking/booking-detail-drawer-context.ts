import type { Dispatch, SetStateAction } from 'react';
import type { BookingNotesVariant } from '@/components/booking/BookingNotesEditablePanel';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import type { BookingStatus } from '@/lib/table-management/booking-status';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import type { StaffRebookGuestPrefill } from '@/lib/booking/staff-rebook-bootstrap';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';
import type { AssignmentSuggestion, BookingDetail } from '@/app/dashboard/bookings/booking-detail-panel-model';

export interface BookingDetailDrawerContext {
  initialSnapshot?: BookingDetailPanelSnapshot | null;
  d: BookingDetail;
  isPopover: boolean;
  panelBodySpacing: string;
  sectionPadding: string;
  loading: boolean;
  optimisticDetail: BookingDetail | null;
  error: string | null;
  startTime: string;
  endTime: string;
  serviceLine: string | null;
  durationMinutes: number;
  bookingStyleIsTable: boolean;
  depositPaid: boolean | number | null;
  depositAmountStr: string | null;
  canChangeStatus: boolean;
  forwardStatuses: BookingStatus[];
  statusRevertAction: { label: string; target?: BookingStatus } | undefined;
  forwardLabel: (status: BookingStatus) => string;
  revertLabel: string | undefined;
  forwardActionVariant: (status: BookingStatus) => 'primary' | 'primary-start' | 'danger' | 'outline-danger';
  hasAssignedTable: boolean;
  tableLine: string | null;
  showAppointmentProcessingEditor: boolean;
  confirmationSentAt: string | undefined;
  setGuestHistoryListRefresh: Dispatch<SetStateAction<number>>;
  actionLoading: boolean;
  isHydrated: boolean;
  detail: BookingDetail | null;
  updateStatus: (status: BookingStatus) => Promise<void>;
  assignedTables: Array<{ id: string; name: string }>;
  optimisticTableLabel: string | null;
  tableManagementEnabled: boolean;
  showAssignModal: boolean;
  setShowAssignModal: Dispatch<SetStateAction<boolean>>;
  suggestionsLoading: boolean;
  assignmentSuggestions: AssignmentSuggestion[];
  allTables: Array<{ id: string; name: string; max_covers: number }>;
  recommendedTableIds: string[];
  bookingId: string;
  setActionLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  load: () => Promise<void>;
  onUpdated: () => void;
  notesVariant: BookingNotesVariant;
  modifyBookingOpen: boolean;
  setModifyBookingOpen: Dispatch<SetStateAction<boolean>>;
  guestHistoryRebookPrefill: StaffRebookGuestPrefill | undefined;
  guestHistoryListRefresh: number;
  setNestedBookingOpen: Dispatch<
    SetStateAction<{
      id: string;
      snapshot: import('@/app/dashboard/bookings/booking-detail-panel-snapshot').BookingDetailPanelSnapshot;
      isAppointment: boolean;
    } | null>
  >;
  stackDepth: number;
  venueTimezone: string;
  venueCurrency: string | undefined;
  venueId: string | undefined;
  processingBlocksDraft: ProcessingTimeBlock[];
  setProcessingBlocksDraft: Dispatch<SetStateAction<ProcessingTimeBlock[]>>;
  appointmentCoreMinutesForProcessing: number;
  persistProcessingBlocks: () => Promise<void>;
  runDepositAction: (
    action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund' | 'release_hold',
  ) => Promise<void>;
  executePermanentDelete: () => Promise<void>;
  setConfirmDialog: Dispatch<
    SetStateAction<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>
  >;
  customMessage: string;
  setCustomMessage: Dispatch<SetStateAction<string>>;
  guestMessageChannel: GuestMessageChannel;
  setGuestMessageChannel: Dispatch<SetStateAction<GuestMessageChannel>>;
  onClose: () => void;
}
