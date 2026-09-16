"use client"

import { Check, Zap } from "lucide-react"

import { useApprovals } from "@/features/approvals/components/approvals-provider"
import { approvals } from "@/mocks/approvals"

export function Approvals() {
  const { approved, setApproved } = useApprovals()

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">Ações sensíveis</p>
        <h2 className="text-3xl font-bold tracking-[-.04em]">Aprovações</h2>
        <p className="mt-2 text-sm text-slate-500">
          Revise e autorize as ações recomendadas pelos seus agentes.
        </p>
      </div>
      <div className="space-y-3">
        {approvals.map((approval) =>
          approved.includes(approval.title) ? (
            <div
              key={approval.title}
              className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-700"
            >
              <Check size={18} /> {approval.title} aprovada com sucesso.
            </div>
          ) : (
            <div key={approval.title} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-4">
                <div className="grid size-10 place-items-center rounded-xl bg-[#eeecff] text-[#6254d9]">
                  <Zap size={18} />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold">{approval.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">{approval.detail}</p>
                  <p className="mt-3 text-xs font-bold text-[#6254d9]">{approval.impact}</p>
                </div>
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                  Pendente
                </span>
              </div>
              <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button className="rounded-xl px-4 py-2 text-xs font-bold text-slate-500">Recusar</button>
                <button
                  onClick={() => setApproved((items) => [...items, approval.title])}
                  className="rounded-xl bg-[#6254d9] px-4 py-2 text-xs font-bold text-white"
                >
                  Aprovar ação
                </button>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
