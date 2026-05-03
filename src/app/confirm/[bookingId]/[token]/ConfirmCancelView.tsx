"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { bookingModelShortLabel } from "@/lib/booking/infer-booking-row-model";
import type { BookingModel } from "@/types/booking-models";

interface BookingDetails {
  booking_id: string;
  venue_name: string;
  venue_address: string | null;
  booking_date: string;
  booking_time: string;
  party_size: number;
  deposit_paid: boolean;
  deposit_amount_pence: number | null;
  status: string;
  is_appointment?: boolean;
  booking_model?: BookingModel;
  practitioner_name?: string | null;
  appointment_service_name?: string | null;
  event_name?: string | null;
  class_summary?: string | null;
  resource_name?: string | null;
  booking_end_time?: string | null;
  refund_notice_hours?: number;
  guest_attendance_confirmed_at?: string | null;
  /** Short signed URL to manage / change / cancel (same as reminder email “Manage or cancel”). */
  manage_booking_url?: string | null;
}

type View = "main" | "cancel_confirm" | "done";

export function ConfirmCancelView({
  bookingId,
  token,
  hmac,
}: {
  bookingId: string;
  token?: string;
  hmac?: string;
}) {
  const [details, setDetails] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("main");
  const [actionLoading, setActionLoading] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");

  const authParam = hmac
    ? `hmac=${encodeURIComponent(hmac)}`
    : `token=${encodeURIComponent(token ?? "")}`;

  useEffect(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    fetch(
      `${base}/api/confirm?booking_id=${encodeURIComponent(bookingId)}&${authParam}`,
    )
      .then((r) => {
        if (!r.ok)
          return r
            .json()
            .then((j) => Promise.reject(new Error(j.error ?? "Failed")));
        return r.json();
      })
      .then((data) => {
        setDetails(data);
        if (
          typeof window !== "undefined" &&
          window.location.hash === "#cancel"
        ) {
          setView("cancel_confirm");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Invalid link"))
      .finally(() => setLoading(false));
  }, [bookingId, authParam]);

  const doAction = useCallback(
    async (action: "confirm" | "cancel") => {
      setActionLoading(true);
      const base = typeof window !== "undefined" ? window.location.origin : "";
      const authBody = hmac ? { hmac } : { token };
      try {
        const res = await fetch(`${base}/api/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booking_id: bookingId, ...authBody, action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed");
        setDoneMessage(
          data.message ??
            (action === "confirm" ? "You're confirmed!" : "Booking cancelled."),
        );
        setView("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setActionLoading(false);
      }
    },
    [bookingId, token, hmac],
  );

  if (loading) {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg
              className="h-6 w-6 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
          </div>
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!details) return null;

  const dateStr = new Date(
    details.booking_date + "T12:00:00",
  ).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const depositStr = details.deposit_amount_pence
    ? `£${(details.deposit_amount_pence / 100).toFixed(2)}`
    : null;
  const bookingSummary =
    details.event_name ??
    details.class_summary ??
    (details.resource_name
      ? details.booking_end_time
        ? `${details.resource_name} · until ${details.booking_end_time}`
        : details.resource_name
      : null) ??
    (details.is_appointment &&
    (details.practitioner_name || details.appointment_service_name)
      ? [details.practitioner_name, details.appointment_service_name]
          .filter(Boolean)
          .join(" · ")
      : null);
  const refundHours = details.refund_notice_hours ?? 48;
  const bookingModel = details.booking_model ?? "table_reservation";
  const isCde =
    bookingModel === "event_ticket" ||
    bookingModel === "class_session" ||
    bookingModel === "resource_booking";

  if (view === "done") {
    const isConfirm = doneMessage.toLowerCase().includes("confirm");
    return (
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div
            className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${isConfirm ? "bg-emerald-50" : "bg-slate-100"}`}
          >
            <svg
              className={`h-7 w-7 ${isConfirm ? "text-emerald-600" : "text-slate-500"}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m4.5 12.75 6 6 9-13.5"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            {doneMessage}
          </h2>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (view === "cancel_confirm") {
    return (
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="bg-red-600 px-6 py-5">
            <h2 className="text-lg font-semibold text-white">
              Cancel Booking?
            </h2>
          </div>
          <div className="p-6 space-y-4">
            {details.deposit_paid && details.deposit_amount_pence ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-medium">Deposit Policy</p>
                <p className="mt-1 text-xs">
                  {isCde
                    ? `Full refund if cancelled ${refundHours}+ hours before your booking starts. No refund within ${refundHours} hours or for no-shows.`
                    : `Full refund if cancelled ${refundHours}+ hours before your booking. No refund within ${refundHours} hours or for no-shows.`}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Are you sure you want to cancel your booking?
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setView("main");
                  setError(null);
                }}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Keep Booking
              </button>
              <button
                type="button"
                onClick={() => doAction("cancel")}
                disabled={actionLoading}
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? "Cancelling..." : "Yes, Cancel"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      {/* Brand */}
      <div className="mb-6">
        <img src="/Logo.png" alt="ReserveNI" className="h-8 w-auto" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Venue header */}
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-5">
          <h2 className="text-lg font-semibold text-white">
            {details.venue_name}
          </h2>
          {details.venue_address && (
            <p className="mt-0.5 text-sm text-brand-100">
              {details.venue_address}
            </p>
          )}
        </div>

        <div className="p-6 space-y-5">
          {/* Booking details */}
          <div className="grid grid-cols-2 gap-3">
            <DetailTile label="Date" value={dateStr} />
            <DetailTile label="Time" value={details.booking_time.slice(0, 5)} />
            <DetailTile
              label="Guests"
              value={`${details.party_size} ${details.party_size === 1 ? "guest" : "guests"}`}
            />
            <DetailTile
              label="Deposit"
              value={
                details.deposit_paid
                  ? `Paid ${depositStr ?? ""}`
                  : "Not required"
              }
            />
          </div>

          {bookingSummary && (
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800">
              <p className="text-xs font-medium text-slate-500">
                {isCde ? bookingModelShortLabel(bookingModel) : "Booking"}
              </p>
              <p className="mt-0.5 font-semibold leading-snug">
                {bookingSummary}
              </p>
            </div>
          )}

          <p className="text-sm text-slate-500">
            Confirm your booking below, or open Manage or cancel to change the
            time, party size, or cancel.
          </p>

          {details.manage_booking_url && (
            <a
              href={details.manage_booking_url}
              className="flex w-full items-center justify-center rounded-xl border-2 border-brand-600 bg-white px-4 py-3.5 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-50"
            >
              Manage or cancel booking
            </a>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => doAction("confirm")}
              disabled={actionLoading}
              className="w-full rounded-xl bg-brand-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {actionLoading ? "Updating..." : "Confirm my booking"}
            </button>
            <button
              type="button"
              onClick={() => setView("cancel_confirm")}
              disabled={actionLoading}
              className="w-full rounded-xl border border-red-200 bg-white px-4 py-3.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel booking
            </button>
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        <Link href="/" className="hover:text-brand-600">
          Powered by ReserveNI
        </Link>
      </p>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}
