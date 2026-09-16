"use client"

import { Home, ArrowLeftRight, CreditCard, User, QrCode } from "lucide-react"

interface NavBarProps {
  activeTab: string
  onNavChange: (tab: string) => void
}

export function NavBar({ activeTab, onNavChange }: NavBarProps) {
  return (
    <div className="relative flex items-center justify-around px-4 pt-3 pb-5 bg-white border-t border-border flex-shrink-0">
      <div className="absolute -top-6 left-1/2 -translate-x-1/2">
        <button
          onClick={() => onNavChange("qr")}
          className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"
          style={{ backgroundColor: "#C8E63A" }}
        >
          <QrCode size={22} className="text-forest" />
        </button>
      </div>
      <NavItem icon={<Home size={20} />} label="Home" active={activeTab === "home"} onClick={() => onNavChange("home")} />
      <NavItem icon={<ArrowLeftRight size={20} />} label="Transactions" active={activeTab === "transactions"} onClick={() => onNavChange("transactions")} />
      <div className="w-12" />
      <NavItem icon={<CreditCard size={20} />} label="Cards" active={activeTab === "cards"} onClick={() => onNavChange("cards")} />
      <NavItem icon={<User size={20} />} label="Profile" active={activeTab === "profile"} onClick={() => onNavChange("profile")} />
    </div>
  )
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 min-w-[44px]">
      <span className={active ? "text-forest" : "text-muted-foreground"}>{icon}</span>
      <span className={`text-[10px] font-medium ${active ? "text-forest font-bold" : "text-muted-foreground"}`}>
        {label}
      </span>
    </button>
  )
}
