# Docs archive

Documents in this folder are **historical**. They are completed implementation
prompts, delivered build plans, and superseded reviews whose features have
shipped. They are kept for audit trail and architecture rationale, but they
**no longer describe current functionality or active plans**. Do not treat them
as a source of truth.

First wave archived 21 May 2026. Second wave archived 4 July 2026 (the shipped
plans and superseded reviews in the lower half of the table below).

| Document | Type | Why archived |
|----------|------|--------------|
| `Appointments_Light_Plan_Information.md` | Cursor prompt | Light pricing tier shipped (`src/lib/billing/`) |
| `ReserveNI_Booking_Import_Implementation.md` | Cursor prompt | Booking import shipped (`/dashboard/import`) |
| `ReserveNI_Import_Tool_Design_Plan.md` | Cursor prompt | Import wizard shipped |
| `Timetable_Rebuild.md` | Build plan | Class timetable rebuilt and live |
| `ReserveNI_Table_Management_Implementation_Plan.md` | Build plan | Table management shipped |
| `reserveni-automatic-table-combination-engine-prompt.md` | Cursor prompt | Combination engine shipped (`src/lib/table-management/`) |
| `reserveni-table-management-consolidation-prompt.md` | Cursor prompt | Covers/table mode toggle shipped (`src/lib/venue-mode.ts`) |
| `reserveni-floor-plan-table-grid-full-functionality-prompt.md` | Cursor prompt | Floor plan / table grid shipped |
| `Prompt - Simple Table Tracking (Covers Mode).md` | Cursor prompt | Covers mode shipped |
| `ReserveNI_Unified_Scheduling_Engine_Plan.md` | Build guide | Unified Scheduling Engine shipped, retained for architecture rationale |
| `reserveni-linked-calendar-grid-integration-scope.md` | Scope doc | Calendar grid integration shipped |
| `Resneo_Add_Ons_Implementation_Plan.md` | Build plan | Add-ons shipped (`src/lib/addons/`, booking add-ons step, `20261201120000_addons.sql`) |
| `REFERRAL_PROGRAMME_PLAN.md` | Build plan | Referral programme shipped (`src/lib/referrals/`, `/dashboard/referrals`, `/api/referrals/*`) |
| `reserveni-combined-booking-page-plan.md` | Build plan | Combined booking page shipped (`src/lib/linked-accounts/collective-venue.ts`, `/book/c/[slug]`) |
| `reserveni-collective-booking-page-scope.md` | Scope doc | Superseded by the combined-booking-page plan; directory flow retired, cross-suggestion shipped |
| `reserveni-class-products-plan.md` | Build plan | Class commerce products shipped (`src/lib/class-commerce/`) |
| `Resneo-Class-Event-Resource-Functionality-Review-And-Plan-May-2026.md` | Review + plan | Superseded by `Docs/Resneo-Classes-Events-Resources-Review-June-2026.md`; findings delivered |
| `Resneo_Import_Tool_Review_And_AI_Rework_Plan.md` | Rework plan | Import AI rework shipped (`src/lib/import/`); current state in `Docs/Resneo_Import_Tool_Current_State_Review_June_2026.md` |
| `reserveni-compliance-improvement-plan.md` | Improvement plan | Compliance gap-closing work delivered; corrections folded into `Docs/reserveni-compliance-spec.md` |
| `UI_EXCELLENCE_REVIEW_AND_PLAN.md` | Review + plan | UI foundation shipped (`src/components/ui/primitives/`); current reference is `Docs/DESIGN_SYSTEM.md` |

For current functionality and roadmap see `Docs/Resneo-Appointments-Review-And-Roadmap.md`
and `Docs/PRD.md`.
