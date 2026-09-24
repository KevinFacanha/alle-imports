import type { ReactNode } from "react"

export type CommercialView = "daily" | "comparison"

export function CommercialHeader({
  view,
  controls,
  onViewChange,
}: {
  view: CommercialView
  controls?: ReactNode
  onViewChange: (view: CommercialView) => void
}) {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-[#f8f7ff] p-5 sm:p-6 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-xl">
        <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">
          GABI · Comercial
        </p>
        <h2
          id="commercial-intelligence-title"
          className="text-2xl font-bold tracking-[-.04em] sm:text-3xl"
        >
          Inteligência Comercial
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Indicadores processados e conciliados por conta e data de negócio.
        </p>
        <div
          className="mt-5 inline-flex rounded-xl border border-slate-200 bg-white p-1"
          role="tablist"
          aria-label="Visões de inteligência comercial"
        >
          <ViewButton
            active={view === "daily"}
            onClick={() => onViewChange("daily")}
          >
            Visão diária
          </ViewButton>
          <ViewButton
            active={view === "comparison"}
            onClick={() => onViewChange("comparison")}
          >
            Comparar contas
          </ViewButton>
        </div>
      </div>
      {controls}
    </div>
  )
}

function ViewButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "rounded-lg bg-[#6254d9] px-3.5 py-2 text-xs font-bold text-white shadow-sm"
          : "rounded-lg px-3.5 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
      }
    >
      {children}
    </button>
  )
}
