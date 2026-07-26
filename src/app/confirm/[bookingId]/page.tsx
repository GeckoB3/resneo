"use client";

import { use, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ConfirmCancelView } from "./[token]/ConfirmCancelView";
import { BrandSpinner } from "@/components/ui/primitives";

function ConfirmContent({
  paramsPromise,
}: {
  paramsPromise: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = use(paramsPromise);
  const searchParams = useSearchParams();
  const hmac = searchParams.get("hmac") ?? "";

  if (!hmac) {
    return (
      <div className="w-full max-w-md text-center">
        <div className="rounded-2xl border border-red-200 bg-white p-8 shadow-sm">
          <p className="text-sm text-red-600">
            Invalid link - missing authentication.
          </p>
        </div>
      </div>
    );
  }

  return <ConfirmCancelView bookingId={bookingId} hmac={hmac} />;
}

export default function ConfirmHmacPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md text-center">
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <BrandSpinner className="mx-auto h-8 w-8" />
            </div>
          </div>
        }
      >
        <ConfirmContent paramsPromise={params} />
      </Suspense>
    </main>
  );
}
