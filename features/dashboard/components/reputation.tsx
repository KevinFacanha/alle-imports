import type { ReputationMetric } from "@/features/dashboard/types"

export function Reputation({ name, score, progress }: ReputationMetric) {
  return (
    <div>
      <div className="mb-2 flex justify-between text-sm font-bold">
        <span>{name}</span>
        <span className="text-emerald-600">
          {score} <small className="font-normal text-slate-400">/ 5,0</small>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-400" style={{ width: progress }} />
      </div>
    </div>
  )
}
