import { AlertTriangle } from "lucide-react"

import type { AlertTone } from "@/types/alerts"

interface PageListItem {
  title: string
  detail: string
  tone: AlertTone
}

interface PageListProps {
  title: string
  eyebrow: string
  description: string
  items: readonly PageListItem[]
}

export function PageList({ title, eyebrow, description, items }: PageListProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">{eyebrow}</p>
        <h2 className="text-3xl font-bold tracking-[-.04em]">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={item.title}
            className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5"
          >
            <div
              className={`grid size-10 place-items-center rounded-xl ${item.tone === "critical" ? "bg-rose-50 text-rose-500" : item.tone === "warning" ? "bg-amber-50 text-amber-500" : "bg-[#eeecff] text-[#6254d9]"}`}
            >
              <AlertTriangle size={18} />
            </div>
            <div className="flex-1">
              <p className="font-bold">{item.title}</p>
              <p className="mt-1 text-xs text-slate-400">
                {item.detail} · há {index + 1}h
              </p>
            </div>
            <button className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
              Ver detalhes
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
