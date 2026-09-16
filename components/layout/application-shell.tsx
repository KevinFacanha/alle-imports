import type { ReactNode } from "react"

import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"
import type { View } from "@/types/navigation"

interface ApplicationShellProps {
  activeView: View
  isSidebarOpen: boolean
  onNavigate: (view: View) => void
  onOpenSidebar: () => void
  children: ReactNode
}

export function ApplicationShell({
  activeView,
  isSidebarOpen,
  onNavigate,
  onOpenSidebar,
  children,
}: ApplicationShellProps) {
  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-900">
      <Sidebar activeView={activeView} isOpen={isSidebarOpen} onNavigate={onNavigate} />
      <main className="lg:pl-[248px]">
        <Header activeView={activeView} onOpenSidebar={onOpenSidebar} />
        <div className="mx-auto max-w-[1400px] p-5 sm:p-8">{children}</div>
      </main>
    </div>
  )
}
