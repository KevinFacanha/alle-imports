import { ChevronRight, Clock3, ShieldCheck } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ProductTable } from "@/features/dashboard/components/product-table"
import { Reputation } from "@/features/dashboard/components/reputation"
import { channels } from "@/mocks/channels"
import { reputationMetrics, sales, salesMetrics } from "@/mocks/sales"

export function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">GABI · Comercial</p>
          <h2 className="text-3xl font-bold tracking-[-.04em]">Visão geral da operação</h2>
          <p className="mt-2 text-sm text-slate-500">Acompanhe o desempenho dos seus canais em tempo real.</p>
        </div>
        <button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600">
          <Clock3 size={15} /> Últimos 7 dias <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {salesMetrics.map(({ label, value, growth, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between text-xs font-semibold text-slate-400">
              <span>{label}</span>
              <Icon size={16} className="text-[#6254d9]" />
            </div>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            <p className="mt-2 text-[11px] font-bold text-emerald-600">
              {growth} <span className="font-medium text-slate-400">vs. período anterior</span>
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-5 flex justify-between">
            <div>
              <h3 className="font-bold">Faturamento</h3>
              <p className="mt-1 text-xs text-slate-400">Evolução dos últimos 7 dias</p>
            </div>
            <span className="text-lg font-bold">R$ 130,5k</span>
          </div>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sales}>
                <defs>
                  <linearGradient id="sales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7165e8" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#7165e8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#eef0f5" />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(value: number) => `${value / 1000}k`}
                />
                <Tooltip
                  formatter={(value) => [
                    `R$ ${Number(value).toLocaleString("pt-BR")}`,
                    "Vendas",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#6254d9"
                  strokeWidth={3}
                  fill="url(#sales)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold">Canais de venda</h3>
          <p className="mt-1 text-xs text-slate-400">Participação no faturamento</p>
          <div className="flex items-center justify-center gap-8 py-7">
            <div className="h-[145px] w-[145px]">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={channels}
                    innerRadius={48}
                    outerRadius={68}
                    dataKey="value"
                    strokeWidth={3}
                    stroke="white"
                  >
                    <Cell fill="#6254d9" />
                    <Cell fill="#c7c1ff" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-4 text-xs">
              <div>
                <p className="mb-1 flex items-center gap-2 font-semibold">
                  <span className="size-2.5 rounded-full bg-[#6254d9]" /> Mercado Livre
                </p>
                <b className="pl-4 text-xl">58%</b>
              </div>
              <div>
                <p className="mb-1 flex items-center gap-2 font-semibold">
                  <span className="size-2.5 rounded-full bg-[#c7c1ff]" /> Shopee
                </p>
                <b className="pl-4 text-xl">42%</b>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ProductTable />
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="font-bold">Reputação dos canais</h3>
              <p className="mt-1 text-xs text-slate-400">Saúde operacional</p>
            </div>
            <ShieldCheck className="text-emerald-500" size={20} />
          </div>
          <div className="space-y-5">
            {reputationMetrics.map((reputation) => (
              <Reputation key={reputation.name} {...reputation} />
            ))}
          </div>
          <div className="mt-6 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
            <b>Atenção:</b> a reputação de Coleta caiu 0,2 pontos nesta semana.
          </div>
        </div>
      </div>
    </div>
  )
}
