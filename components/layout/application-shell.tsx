"use client"

import { useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"
import { navigationItems } from "@/mocks/navigation"

interface ApplicationShellProps {
  children: ReactNode
}

export function ApplicationShell({ children }: ApplicationShellProps) {
  const pathname = usePathname()
  const [isSidebarOpen, setSidebarOpen] = useState(false)
  const activeView = navigationItems.find((item) => item.href === pathname)?.id ?? "assistente"

  return (
    <div className="min-h-screen bg-[#f7f8fc] text-slate-900">
      <Sidebar
        activeView={activeView}
        isOpen={isSidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
      />
      <main className="lg:pl-[248px]">
        <Header activeView={activeView} onOpenSidebar={() => setSidebarOpen(true)} />
        <div className="mx-auto max-w-[1400px] p-5 sm:p-8">{children}</div>
      </main>
    </div>
  )
}
