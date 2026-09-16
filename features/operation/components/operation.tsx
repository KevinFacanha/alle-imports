import { ChevronRight } from "lucide-react"

import { humanInterventions, operationMetrics } from "@/mocks/operation"

export function Operation() {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">VEIA · Operação</p>
        <h2 className="text-3xl font-bold tracking-[-.04em]">Tudo sob controle</h2>
        <p className="mt-2 text-sm text-slate-500">Priorize o que precisa da sua atenção hoje.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {operationMetrics.map(
          ({ name, value, detail, icon: Icon, colorClassName, backgroundClassName }) => (
            <div key={name} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className={`mb-5 grid size-10 place-items-center rounded-xl ${backgroundClassName}`}>
                <Icon size={19} className={colorClassName} />
              </div>
              <p className="text-sm font-semibold text-slate-500">{name}</p>
              <div className="mt-2 flex items-end justify-between">
                <b className="text-3xl">{value}</b>
                <span className="text-[11px] font-bold text-[#6254d9]">{detail}</span>
              </div>
            </div>
          ),
        )}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="font-bold">Intervenções humanas</h3>
            <p className="mt-1 text-xs text-slate-400">Casos identificados pela VEIA</p>
          </div>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-600">3 pendentes</span>
        </div>
        {humanInterventions.map((intervention, index) => (
          <div
            key={intervention.description}
            className="flex items-center gap-4 border-t border-slate-100 py-4 text-sm"
          >
            <div className="grid size-8 place-items-center rounded-lg bg-slate-50 text-slate-500">
              {index + 1}
            </div>
            <span className="flex-1 font-medium">{intervention.description}</span>
            <button className="text-xs font-bold text-[#6254d9]">
              Resolver <ChevronRight className="inline" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
