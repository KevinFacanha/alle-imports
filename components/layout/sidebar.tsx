import Link from "next/link"
import { ChevronRight, CircleHelp, Settings2, Sparkles } from "lucide-react"

import { navigationItems } from "@/mocks/navigation"
import type { View } from "@/types/navigation"

interface SidebarProps {
  activeView: View
  isOpen: boolean
  onNavigate: () => void
}

export function Sidebar({ activeView, isOpen, onNavigate }: SidebarProps) {
  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-slate-200 bg-white px-4 py-5 transition-transform lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-9 flex items-center gap-3 px-2">
          <div className="grid size-9 place-items-center rounded-xl bg-[#6254d9] text-white shadow-lg shadow-indigo-200">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="text-[15px] font-bold tracking-tight">Ale Intelligence</p>
            <p className="text-[10px] font-medium uppercase tracking-[.18em] text-slate-400">
              Operação inteligente
            </p>
          </div>
        </div>
        <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">
          Workspace
        </div>
        <nav className="flex flex-col gap-1">
          {navigationItems.map(({ id, href, label, icon: Icon, badge }) => (
            <Link
              key={id}
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition ${activeView === id ? "bg-[#6254d9] text-white shadow-md shadow-indigo-100" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
            >
              <Icon size={17} />
              {label}
              {badge && (
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>
                  {badge.label}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="mb-4 rounded-2xl bg-[#f5f4ff] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#6254d9]">GABI + VEIA</span>
              <span className="size-2 rounded-full bg-emerald-400" />
            </div>
            <p className="text-xs leading-5 text-slate-600">Seus agentes estão monitorando a operação.</p>
            <button className="mt-3 flex items-center gap-1 text-[11px] font-bold text-[#6254d9]">
              Ver status <ChevronRight size={13} />
            </button>
          </div>
          <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">
            <Settings2 size={17} /> Configurações
          </button>
          <div className="mt-4 flex items-center gap-3 border-t border-slate-100 px-2 pt-4">
            <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#f1c7a8] to-[#a66c52] text-xs font-bold text-white">
              AP
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">Ana Paula</p>
              <p className="text-[10px] text-slate-400">Admin</p>
            </div>
            <CircleHelp className="ml-auto text-slate-400" size={16} />
          </div>
        </div>
      </aside>
      {isOpen && (
        <button
          aria-label="Fechar menu"
          onClick={onNavigate}
          className="fixed inset-0 z-20 bg-slate-900/20 lg:hidden"
        />
      )}
    </>
  )
}
