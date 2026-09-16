import { Bell, Menu } from "lucide-react"

import { navigationItems } from "@/mocks/navigation"
import type { View } from "@/types/navigation"

interface HeaderProps {
  activeView: View
  onOpenSidebar: () => void
}

export function Header({ activeView, onOpenSidebar }: HeaderProps) {
  const title =
    activeView === "assistente"
      ? "Assistente"
      : navigationItems.find((item) => item.id === activeView)?.label

  return (
    <header className="flex h-[72px] items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur sm:px-8">
      <div className="flex items-center gap-4">
        <button aria-label="Abrir menu" onClick={onOpenSidebar} className="lg:hidden">
          <Menu size={21} />
        </button>
        <div>
          <p className="text-[11px] font-semibold text-slate-400">Terça-feira, 14 de maio de 2024</p>
          <h1 className="text-lg font-bold tracking-tight">{title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="relative grid size-9 place-items-center rounded-xl border border-slate-200 text-slate-500">
          <Bell size={17} />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-rose-500" />
        </button>
        <div className="hidden h-8 w-px bg-slate-200 sm:block" />
        <div className="hidden items-center gap-2 sm:flex">
          <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#f1c7a8] to-[#a66c52] text-xs font-bold text-white">
            AP
          </div>
          <span className="text-xs font-bold">Ana Paula</span>
        </div>
      </div>
    </header>
  )
}
