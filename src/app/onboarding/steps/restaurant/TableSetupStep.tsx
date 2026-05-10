'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FloorPlanEditorTabs, type FloorPlanEditorTabKey } from '@/app/dashboard/availability/FloorPlanEditorTabs';
import { useRestaurantOnboardingAvailability } from '@/hooks/use-restaurant-onboarding-availability';

interface Props {
  onDone: () => Promise<void>;
}

export function TableSetupStep({ onDone }: Props) {
  const { selectedAreaId, loading: areaLoading } = useRestaurantOnboardingAvailability();
  const [floorTab, setFloorTab] = useState<FloorPlanEditorTabKey>('layout');
  const [layoutSaveCount, setLayoutSaveCount] = useState(0);
  const [combinationThreshold, setCombinationThreshold] = useState(80);
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/venue/tables/settings');
        if (res.ok && !cancelled) {
          const data = (await res.json()) as {
            settings?: { combination_threshold?: number };
          };
          const ct = data.settings?.combination_threshold;
          if (typeof ct === 'number') setCombinationThreshold(ct);
        }
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLayoutSaved = useCallback(() => {
    setLayoutSaveCount((n) => n + 1);
  }, []);

  if (areaLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-bold text-slate-900">Lay out your tables</h2>
      <p className="mb-3 text-sm text-slate-500">
        Because you chose <strong className="font-medium text-slate-700">Advanced table management</strong>,
        online booking will check a specific table is free for each party. Add the tables you actually have,
        set their covers, and (optionally) arrange them on the floor plan.
      </p>

      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="mb-2 font-medium text-slate-800">Three ways to get set up</p>
        <ul className="list-inside list-disc space-y-1">
          <li><strong className="font-medium">Quickest:</strong> use the <em>Tables</em> tab to add a list of tables and covers. You can skip the visual layout for now.</li>
          <li><strong className="font-medium">Typical:</strong> use the <em>Layout</em> tab to drag tables onto the floor plan, then fine-tune shapes and chairs.</li>
          <li><strong className="font-medium">Advanced:</strong> use <em>Areas</em> and <em>Combinations</em> to model multiple rooms and allow tables to be joined for large parties.</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Everything saves as you work. You can come back any time from{' '}
          <Link
            href="/dashboard/availability?tab=layout"
            className="font-medium text-brand-600 underline hover:text-brand-700"
          >
            Availability → Layout
          </Link>
          , or open the floor plan in a new tab from the link below.
        </p>
      </div>

      <FloorPlanEditorTabs
        isAdmin
        activeTab={floorTab}
        onTabChange={setFloorTab}
        advancedTableManagement
        hideHeading
        onLayoutSaved={onLayoutSaved}
        combinationThreshold={combinationThreshold}
        layoutSaveCount={layoutSaveCount}
        onCombinationThresholdSaved={setCombinationThreshold}
        diningAreaId={selectedAreaId}
      />

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => void onDone()}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Skip for now
        </button>
        <div className="flex items-center gap-3">
          <a
            href="/dashboard/floor-plan"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Open floor plan in new tab ↗
          </a>
          <button
            type="button"
            onClick={() => void onDone()}
            className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
