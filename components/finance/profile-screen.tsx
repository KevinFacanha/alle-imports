"use client"

import {
  ChevronRight,
  Shield,
  Bell,
  HelpCircle,
  LogOut,
  Edit3,
} from "lucide-react"
import { NavBar } from "@/components/finance/nav-bar"

interface ProfileScreenProps {
  onNavChange: (tab: string) => void
  activeTab: string
  hideNavBar?: boolean
}

const menuItems = [
  { icon: Edit3, label: "Edit Profile", sub: "Update your personal info" },
  { icon: Shield, label: "Security & Privacy", sub: "Password, 2FA, biometrics" },
  { icon: Bell, label: "Notifications", sub: "Manage your alerts" },
  { icon: HelpCircle, label: "Help & Support", sub: "FAQs and contact us" },
  { icon: LogOut, label: "Sign Out", sub: "Log out of your account", danger: true },
]

const stats = [
  { label: "Total Spent", value: "$12,480" },
  { label: "Transactions", value: "284" },
  { label: "Saved", value: "$3,200" },
]

export function ProfileScreen({ onNavChange, activeTab, hideNavBar }: ProfileScreenProps) {
  return (
    <div className="flex flex-col h-full bg-cream overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center justify-between px-5 pt-3 pb-1">
        <span className="text-xs font-semibold text-forest">9:41</span>
        <div className="flex items-center gap-1">
          <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor" className="text-forest">
            <rect x="0" y="3" width="3" height="9" rx="1" opacity="0.4"/>
            <rect x="4.5" y="2" width="3" height="10" rx="1" opacity="0.6"/>
            <rect x="9" y="0.5" width="3" height="11.5" rx="1" opacity="0.8"/>
            <rect x="13.5" y="0" width="3" height="12" rx="1"/>
          </svg>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" className="text-forest">
            <path d="M8 2.4C10.5 2.4 12.7 3.5 14.2 5.2L15.5 3.8C13.6 1.7 11 0.4 8 0.4C5 0.4 2.4 1.7 0.5 3.8L1.8 5.2C3.3 3.5 5.5 2.4 8 2.4Z" opacity="0.3"/>
            <path d="M8 5.6C9.8 5.6 11.4 6.4 12.5 7.6L13.8 6.2C12.3 4.6 10.3 3.6 8 3.6C5.7 3.6 3.7 4.6 2.2 6.2L3.5 7.6C4.6 6.4 6.2 5.6 8 5.6Z" opacity="0.6"/>
            <path d="M8 8.8C9.1 8.8 10 9.3 10.7 10L8 12.8L5.3 10C6 9.3 6.9 8.8 8 8.8Z"/>
          </svg>
          <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
            <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" strokeOpacity="0.35" className="text-forest"/>
            <rect x="1.5" y="1.5" width="16" height="9" rx="2.5" fill="currentColor" className="text-forest"/>
            <path d="M23 4v4a2 2 0 000-4z" fill="currentColor" opacity="0.4" className="text-forest"/>
          </svg>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {/* Profile Hero */}
        <div className="flex flex-col items-center gap-3 px-5 pt-4 pb-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full overflow-hidden ring-4" style={{ "--tw-ring-color": "var(--lime)" } as React.CSSProperties}>
              <img src="/images/onboarding-hero.jpg" alt="Alex Piter" className="w-full h-full object-cover object-top" draggable={false} />
            </div>
            <button className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-lime flex items-center justify-center shadow-sm">
              <Edit3 size={12} className="text-forest" />
            </button>
          </div>
          <div className="text-center">
            <p className="text-lg font-extrabold text-forest">Alex Piter</p>
            <p className="text-xs text-muted-foreground">alex.piter@email.com</p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="mx-4 mb-4 bg-forest rounded-3xl p-4 flex justify-around">
          {stats.map((s, i) => (
            <div key={s.label} className={`flex flex-col items-center gap-0.5 ${i < stats.length - 1 ? "border-r border-white/10 pr-4 mr-4" : ""}`}>
              <p className="text-base font-extrabold text-lime">{s.value}</p>
              <p className="text-[9px] text-white/60">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Menu */}
        <div className="mx-4 space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                className="w-full flex items-center gap-3 bg-white rounded-2xl p-3.5 shadow-sm"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.danger ? "bg-red-50" : "bg-cream"}`}>
                  <Icon size={16} className={item.danger ? "text-red-500" : "text-forest"} />
                </div>
                <div className="flex-1 text-left">
                  <p className={`text-sm font-semibold ${item.danger ? "text-red-500" : "text-forest"}`}>{item.label}</p>
                  <p className="text-[10px] text-muted-foreground">{item.sub}</p>
                </div>
                {!item.danger && <ChevronRight size={16} className="text-muted-foreground" />}
              </button>
            )
          })}
        </div>

        {/* Home indicator */}
        <div className="flex justify-center pt-4">
          <div className="w-32 h-1 bg-foreground/20 rounded-full" />
        </div>
      </div>

      {!hideNavBar && <NavBar activeTab={activeTab} onNavChange={onNavChange} />}
    </div>
  )
}
