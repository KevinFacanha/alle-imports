"use client"

import {
  Bell, Eye, EyeOff, Plus, ArrowUpRight, Download, ChevronRight,
  ArrowLeftRight, CreditCard, TrendingUp, TrendingDown, MoreHorizontal,
  Shield, Edit3, HelpCircle, LogOut, Send, QrCode, ChevronDown,
  ArrowRight, CheckCircle, Zap, Globe,
} from "lucide-react"
import { useState } from "react"

// ─── Shared data ─────────────────────────────────────────────────────────────

const contacts = [
  { id: 1, name: "Jane", initials: "JA", color: "#C8E63A", textColor: "#1B3A2D" },
  { id: 2, name: "Kristin", initials: "KR", color: "#1B3A2D", textColor: "#ffffff" },
  { id: 3, name: "Hawkins", initials: "HW", color: "#8B5CF6", textColor: "#ffffff" },
  { id: 4, name: "Darlene", initials: "DA", color: "#F59E0B", textColor: "#ffffff" },
  { id: 5, name: "Sam", initials: "SM", color: "#EC4899", textColor: "#ffffff" },
  { id: 6, name: "Luke", initials: "LK", color: "#3B82F6", textColor: "#ffffff" },
]

const recentTx = [
  { id: 1, name: "Amazon", date: "Feb 15, 2026", amount: -80, category: "Shopping", icon: "A", iconBg: "#1a1a1a", iconColor: "white" },
  { id: 2, name: "Bank Transfer", date: "Feb 10, 2026", amount: 700, category: "Income", icon: "B", iconBg: "#1B3A2D", iconColor: "white" },
  { id: 3, name: "McDonald's", date: "Jan 7, 2026", amount: 5, category: "Payment", icon: "M", iconBg: "#DA291C", iconColor: "white" },
  { id: 4, name: "Netflix", date: "Jan 5, 2026", amount: -25, category: "Subscription", icon: "N", iconBg: "#1a1a1a", iconColor: "#E50914" },
  { id: 5, name: "Spotify", date: "Jan 1, 2026", amount: -10, category: "Subscription", icon: "S", iconBg: "#1DB954", iconColor: "white" },
]

const monthlyData = [
  { month: "Jan", income: 2100, spending: 640 },
  { month: "Feb", income: 2635, spending: 780 },
  { month: "Mar", income: 3100, spending: 920 },
  { month: "Apr", income: 2800, spending: 560 },
  { month: "May", income: 3400, spending: 1100 },
  { month: "Jun", income: 3200, spending: 870 },
]

const cards = [
  { id: 1, type: "Debit", network: "VISA", last4: "5690", expiry: "07/30", balance: 12500, gradient: ["#C8E63A", "#b5d42a"], textColor: "#1B3A2D" },
  { id: 2, type: "Debit", network: "VISA", last4: "3421", expiry: "12/28", balance: 8320.5, gradient: ["#1B3A2D", "#2d5c44"], textColor: "#ffffff" },
  { id: 3, type: "Credit", network: "Mastercard", last4: "9017", expiry: "03/27", balance: 24179.5, gradient: ["#2d6070", "#4a8fa8"], textColor: "#ffffff" },
]

const profileStats = [
  { label: "Total Spent", value: "$12,480", icon: TrendingDown, up: false },
  { label: "Total Income", value: "$45,000", icon: TrendingUp, up: true },
  { label: "Transactions", value: "284", icon: ArrowLeftRight, up: true },
  { label: "Saved", value: "$3,200", icon: Shield, up: true },
]

const menuItems = [
  { icon: Edit3, label: "Edit Profile", sub: "Update your personal info" },
  { icon: Shield, label: "Security & Privacy", sub: "Password, 2FA, biometrics" },
  { icon: Bell, label: "Notifications", sub: "Manage your alerts" },
  { icon: HelpCircle, label: "Help & Support", sub: "FAQs and contact us" },
  { icon: LogOut, label: "Sign Out", sub: "Log out of your account", danger: true },
]

// ─── Desktop Onboarding ───────────────────────────────────────────────────────

const slides = [
  {
    headline: "All Your Finances.\nOne Powerful Platform.",
    description: "Send, receive, and manage your money effortlessly — fast, secure, and designed for everyday life.",
    feature: "Bank-grade 256-bit encryption",
    featureIcon: Shield,
  },
  {
    headline: "Smart Tracking.\nSmarter Decisions.",
    description: "Visualize your spending, monitor income, and stay on top of every transaction with beautiful insights.",
    feature: "Real-time analytics & reports",
    featureIcon: Zap,
  },
  {
    headline: "Send Money\nin Seconds.",
    description: "Instant transfers to friends and family. No fees, no fuss — just seamless payments at your fingertips.",
    feature: "200+ countries supported",
    featureIcon: Globe,
  },
]

const featureHighlights = [
  { icon: Shield, label: "Secure Payments", value: "256-bit SSL" },
  { icon: Zap, label: "Instant Transfers", value: "< 1 second" },
  { icon: Globe, label: "Global Access", value: "200+ countries" },
  { icon: TrendingUp, label: "Smart Analytics", value: "Real-time" },
]

export function DesktopOnboarding({
  currentSlide,
  onSlideChange,
  onComplete,
}: {
  currentSlide: number
  onSlideChange: (n: number) => void
  onComplete: () => void
}) {
  const slide = slides[currentSlide] ?? slides[0]
  const isLast = currentSlide === slides.length - 1

  const handleNext = () => {
    if (isLast) onComplete()
    else onSlideChange(currentSlide + 1)
  }

  return (
    <div className="h-full flex overflow-hidden bg-cream select-none">
      {/* Left panel — hero image + overlay */}
      <div className="w-[45%] relative flex-shrink-0 overflow-hidden rounded-bl-2xl" style={{ background: "#1B3A2D" }}>
        <img
          src="/images/onboarding-hero.jpg"
          alt="Woman managing finances"
          className="absolute inset-0 w-full h-full object-cover object-top opacity-60"
          draggable={false}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #1B3A2D 15%, transparent 60%)" }} />

        {/* Logo */}
        <div className="absolute top-8 left-8 flex items-center gap-2.5 z-10">
          <div className="w-9 h-9 rounded-2xl flex items-center justify-center" style={{ background: "var(--lime)" }}>
            <span className="font-black text-sm" style={{ color: "var(--forest)" }}>FF</span>
          </div>
          <span className="text-white font-extrabold text-lg">FinFlow</span>
        </div>

        {/* Bottom feature highlights */}
        <div className="absolute bottom-8 left-8 right-8 z-10 grid grid-cols-2 gap-2">
          {featureHighlights.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-2xl px-3 py-2.5">
                <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--lime)" }}>
                  <Icon size={13} style={{ color: "var(--forest)" }} />
                </div>
                <div>
                  <p className="text-white text-[10px] font-semibold leading-none">{f.label}</p>
                  <p className="text-white/50 text-[9px] mt-0.5">{f.value}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right panel — slide content */}
      <div className="flex-1 flex flex-col justify-center px-14 py-12">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => onSlideChange(i)}
              className="rounded-full transition-all duration-300"
              style={{
                height: 6,
                width: i === currentSlide ? 32 : 8,
                background: i === currentSlide ? "var(--forest)" : "var(--forest-dark, #1B3A2D)",
                opacity: i === currentSlide ? 1 : 0.2,
              }}
            />
          ))}
          <span className="ml-2 text-xs text-muted-foreground font-medium">{currentSlide + 1} / {slides.length}</span>
        </div>

        {/* Headline */}
        <h1
          className="font-extrabold text-forest leading-tight mb-4 text-balance whitespace-pre-line"
          style={{ fontSize: "clamp(28px, 3vw, 40px)", letterSpacing: "-0.02em" }}
        >
          {slide.headline}
        </h1>

        {/* Description */}
        <p className="text-muted-foreground leading-relaxed mb-8 max-w-sm" style={{ fontSize: "clamp(14px, 1.2vw, 16px)" }}>
          {slide.description}
        </p>

        {/* Feature pill */}
        <div className="flex items-center gap-2 mb-10">
          <div className="flex items-center gap-2 bg-white border border-border rounded-2xl px-4 py-2.5 shadow-sm">
            <CheckCircle size={14} style={{ color: "var(--lime)" }} />
            <span className="text-sm font-semibold text-forest">{slide.feature}</span>
          </div>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleNext}
            className="flex items-center gap-2.5 px-8 py-4 rounded-2xl font-bold text-base transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: "var(--forest)", color: "white" }}
          >
            {isLast ? "Get Started" : "Next"}
            <ArrowRight size={18} />
          </button>
          {!isLast && (
            <button
              onClick={onComplete}
              className="text-sm text-muted-foreground font-medium hover:text-forest transition-colors"
            >
              Skip for now
            </button>
          )}
        </div>

        {/* Trust badges */}
        <div className="flex items-center gap-6 mt-12 pt-8 border-t border-border">
          {["4.9 ★ App Store", "2M+ Users", "SOC 2 Certified"].map((badge) => (
            <span key={badge} className="text-xs text-muted-foreground font-medium">{badge}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Desktop Home ─────────────────────────────────────────────────────────────

export function DesktopHome({ onNavChange }: { onNavChange: (t: string) => void }) {
  const [balanceVisible, setBalanceVisible] = useState(true)
  const maxIncome = Math.max(...monthlyData.map(d => d.income))

  return (
    <div className="h-full overflow-y-auto scrollbar-hide bg-cream p-6">
      {/* Top row */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Good morning,</p>
          <h1 className="text-2xl font-extrabold text-forest">Alex Piter</h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="relative w-10 h-10 rounded-2xl bg-white border border-border flex items-center justify-center shadow-sm hover:bg-cream transition-colors">
            <Bell size={18} className="text-forest" />
            <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white" />
          </button>
          <div className="w-10 h-10 rounded-2xl overflow-hidden ring-2 ring-lime/40">
            <img src="/images/onboarding-hero.jpg" alt="Alex" className="w-full h-full object-cover object-top" />
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Balance Card */}
        <div className="col-span-2 rounded-3xl p-6" style={{ background: "linear-gradient(135deg, #1B3A2D 0%, #2d5c44 100%)" }}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-white/60 text-sm">Total Balance</p>
            <button
              onClick={() => setBalanceVisible(!balanceVisible)}
              className="w-7 h-7 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              {balanceVisible ? <Eye size={14} className="text-white/60" /> : <EyeOff size={14} className="text-white/60" />}
            </button>
          </div>
          <p className="text-4xl font-extrabold text-white mb-5 tracking-tight">
            {balanceVisible ? "$45,000.00" : "••••••••"}
          </p>
          {/* Mini bar chart */}
          <div className="flex items-end gap-2">
            {monthlyData.map((d) => (
              <div key={d.month} className="flex flex-col items-center gap-1 flex-1">
                <div className="w-full rounded-full bg-white/20" style={{ height: `${Math.round((d.income / maxIncome) * 48)}px` }} />
                <span className="text-[9px] text-white/40">{d.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats column */}
        <div className="flex flex-col gap-4">
          <div className="flex-1 rounded-3xl bg-white p-4 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Income</p>
              <div className="w-7 h-7 rounded-xl bg-green-50 flex items-center justify-center">
                <TrendingUp size={13} className="text-green-500" />
              </div>
            </div>
            <div>
              <p className="text-xl font-extrabold text-forest">$2,635</p>
              <p className="text-[10px] text-green-600 font-semibold">+12.4% this month</p>
            </div>
          </div>
          <div className="flex-1 rounded-3xl bg-white p-4 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Spending</p>
              <div className="w-7 h-7 rounded-xl bg-red-50 flex items-center justify-center">
                <TrendingDown size={13} className="text-red-400" />
              </div>
            </div>
            <div>
              <p className="text-xl font-extrabold text-forest">$780</p>
              <p className="text-[10px] text-red-400 font-semibold">-3.1% this month</p>
            </div>
          </div>
        </div>
      </div>

      {/* Second row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Cards */}
        <div className="col-span-2 bg-white rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-forest">My Cards</h3>
            <button
              className="text-xs font-semibold text-muted-foreground flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-cream transition-colors"
              onClick={() => onNavChange("cards")}
            >
              See all <ChevronRight size={12} />
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
            {cards.map((card) => (
              <div
                key={card.id}
                className="flex-shrink-0 w-48 rounded-2xl p-4"
                style={{ background: `linear-gradient(135deg, ${card.gradient[0]}, ${card.gradient[1]})` }}
              >
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[10px] font-bold opacity-70" style={{ color: card.textColor }}>{card.type}</span>
                  <span className="text-sm font-black" style={{ color: card.textColor }}>{card.network}</span>
                </div>
                <p className="text-[11px] font-bold tracking-widest opacity-90 mb-2" style={{ color: card.textColor }}>
                  •••• {card.last4}
                </p>
                <div className="flex justify-between">
                  <div>
                    <p className="text-[8px] opacity-50" style={{ color: card.textColor }}>Valid</p>
                    <p className="text-xs font-bold" style={{ color: card.textColor }}>{card.expiry}</p>
                  </div>
                </div>
              </div>
            ))}
            <button className="flex-shrink-0 w-14 rounded-2xl border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:bg-cream transition-colors">
              <Plus size={18} />
            </button>
          </div>
        </div>

        {/* Quick Send */}
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-forest mb-4">Quick Send</h3>
          <div className="grid grid-cols-3 gap-3">
            {contacts.slice(0, 6).map((c) => (
              <button key={c.id} className="flex flex-col items-center gap-1 group">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center text-xs font-bold group-hover:scale-105 transition-transform"
                  style={{ backgroundColor: c.color, color: c.textColor }}
                >
                  {c.initials}
                </div>
                <span className="text-[9px] text-muted-foreground">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Third row: Actions + Recent Transactions */}
      <div className="grid grid-cols-3 gap-4">
        {/* Actions */}
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-forest mb-4">Actions</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: <Download size={16} className="text-forest" />, label: "Top Up" },
              { icon: <Send size={16} className="text-forest" />, label: "Send" },
              { icon: <CreditCard size={16} className="text-forest" />, label: "Pay" },
              { icon: <ArrowLeftRight size={16} className="text-forest" />, label: "Transfer" },
            ].map((a) => (
              <button key={a.label} className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-cream hover:bg-cream-dark transition-colors">
                <div className="w-9 h-9 rounded-2xl bg-white border border-border flex items-center justify-center shadow-sm">
                  {a.icon}
                </div>
                <span className="text-[10px] font-semibold text-forest">{a.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="col-span-2 bg-white rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-forest">Recent Transactions</h3>
            <button
              className="text-xs font-semibold text-muted-foreground flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-cream transition-colors"
              onClick={() => onNavChange("transactions")}
            >
              See all <ChevronRight size={12} />
            </button>
          </div>
          <div className="space-y-1">
            {recentTx.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-cream transition-colors cursor-pointer">
                <div
                  className="w-9 h-9 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: tx.iconBg, color: tx.iconColor }}
                >
                  {tx.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-forest">{tx.name}</p>
                  <p className="text-xs text-muted-foreground">{tx.date}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${tx.amount > 0 ? "text-green-600" : "text-red-500"}`}>
                    {tx.amount > 0 ? "+" : ""}${Math.abs(tx.amount).toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{tx.category}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Desktop Transactions ─────────────────────────────────────────────────────

export function DesktopTransactions() {
  const maxVal = Math.max(...monthlyData.map(d => d.income))

  return (
    <div className="h-full overflow-y-auto scrollbar-hide bg-cream p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-forest">Transactions</h1>
          <p className="text-sm text-muted-foreground">Viewing last 6 months</p>
        </div>
        <button className="flex items-center gap-2 bg-white border border-border rounded-2xl px-4 py-2 text-sm font-semibold text-forest shadow-sm hover:bg-cream transition-colors">
          Monthly <ChevronDown size={14} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-3xl p-5 bg-lime">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-forest/70">Total Income</p>
            <div className="w-7 h-7 rounded-xl bg-forest/10 flex items-center justify-center">
              <TrendingUp size={13} className="text-forest" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-forest">$2,635</p>
          <p className="text-xs text-forest/60 mt-1">+12.4% vs last month</p>
        </div>
        <div className="rounded-3xl p-5 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground">Total Spendings</p>
            <div className="w-7 h-7 rounded-xl bg-red-50 flex items-center justify-center">
              <TrendingDown size={13} className="text-red-400" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-forest">$780</p>
          <p className="text-xs text-red-400 mt-1">-3.1% vs last month</p>
        </div>
        <div className="rounded-3xl p-5 bg-forest">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-white/60">Net Savings</p>
            <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center">
              <ArrowUpRight size={13} className="text-lime" />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-lime">$1,855</p>
          <p className="text-xs text-white/50 mt-1">Great progress!</p>
        </div>
      </div>

      {/* Chart + list */}
      <div className="grid grid-cols-5 gap-4">
        {/* Bar chart */}
        <div className="col-span-2 bg-white rounded-3xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-forest mb-4">Income by Month</h3>
          <div className="flex items-end gap-3 h-40">
            {monthlyData.map((d) => (
              <div key={d.month} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-xl" style={{ height: `${Math.round((d.income / maxVal) * 120)}px`, backgroundColor: "#1B3A2D" }} />
                  <div className="w-full rounded-t-xl opacity-40" style={{ height: `${Math.round((d.spending / maxVal) * 120)}px`, backgroundColor: "#C8E63A" }} />
                </div>
                <span className="text-[9px] text-muted-foreground">{d.month}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-md bg-forest" />
              <span className="text-[10px] text-muted-foreground">Income</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-md bg-lime" />
              <span className="text-[10px] text-muted-foreground">Spending</span>
            </div>
          </div>
        </div>

        {/* Transaction list */}
        <div className="col-span-3 bg-white rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-forest">All Transactions</h3>
            <button className="text-xs text-muted-foreground font-semibold flex items-center gap-1 px-3 py-1.5 rounded-xl hover:bg-cream transition-colors">
              Filter <ChevronDown size={12} />
            </button>
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto scrollbar-hide pr-1">
            {[...recentTx, ...recentTx].map((tx, i) => (
              <div key={`${tx.id}-${i}`} className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-cream transition-colors cursor-pointer">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: tx.iconBg, color: tx.iconColor }}
                >
                  {tx.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-forest">{tx.name}</p>
                  <p className="text-xs text-muted-foreground">{tx.date}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold ${tx.amount > 0 ? "text-green-600" : "text-red-500"}`}>
                    {tx.amount > 0 ? "+" : ""}${Math.abs(tx.amount).toFixed(2)}
                  </p>
                  <span
                    className="text-[9px] font-semibold px-2 py-0.5 rounded-lg"
                    style={{
                      background: tx.amount > 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                      color: tx.amount > 0 ? "rgb(22,163,74)" : "rgb(239,68,68)",
                    }}
                  >
                    {tx.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Desktop Cards ────────────────────────────────────────────────────────────

export function DesktopCards() {
  const [showBalances, setShowBalances] = useState<Record<number, boolean>>({})
  const toggle = (id: number) => setShowBalances((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="h-full overflow-y-auto scrollbar-hide bg-cream p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-forest">My Cards</h1>
          <p className="text-sm text-muted-foreground">Manage all your payment cards</p>
        </div>
        <button className="flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-bold text-forest bg-lime shadow-sm hover:scale-[1.02] transition-transform">
          <Plus size={16} /> Add Card
        </button>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {cards.map((card) => (
          <div
            key={card.id}
            className="rounded-3xl p-6 relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${card.gradient[0]}, ${card.gradient[1]})` }}
          >
            <div className="flex justify-between items-center mb-6">
              <div>
                <p className="text-[10px] font-semibold opacity-60" style={{ color: card.textColor }}>{card.type}</p>
                <p className="text-xl font-black" style={{ color: card.textColor }}>{card.network}</p>
              </div>
              <button className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors opacity-70" style={{ color: card.textColor }}>
                <MoreHorizontal size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-0.5 w-8 mb-4">
              {[0, 1, 2, 3].map(i => <div key={i} className="w-2 h-2 rounded-sm opacity-80" style={{ backgroundColor: card.textColor }} />)}
            </div>
            <p className="text-sm font-bold tracking-[0.2em] opacity-90 mb-4" style={{ color: card.textColor }}>
              •••• •••• •••• {card.last4}
            </p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[9px] opacity-50" style={{ color: card.textColor }}>Valid Thru</p>
                <p className="text-sm font-bold" style={{ color: card.textColor }}>{card.expiry}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] opacity-50" style={{ color: card.textColor }}>Balance</p>
                <div className="flex items-center gap-1">
                  <p className="text-base font-extrabold" style={{ color: card.textColor }}>
                    {showBalances[card.id] ? `$${card.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "••••••"}
                  </p>
                  <button
                    onClick={() => toggle(card.id)}
                    className="w-5 h-5 rounded-lg bg-white/10 flex items-center justify-center"
                    style={{ color: card.textColor }}
                  >
                    {showBalances[card.id] ? <EyeOff size={10} /> : <Eye size={10} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent card activity */}
      <div className="bg-white rounded-3xl p-5 shadow-sm">
        <h3 className="text-sm font-bold text-forest mb-4">Recent Card Activity</h3>
        <div className="grid grid-cols-2 gap-2">
          {recentTx.map((tx) => (
            <div key={tx.id} className="flex items-center gap-3 p-3 rounded-2xl bg-cream hover:bg-cream-dark transition-colors cursor-pointer">
              <div
                className="w-9 h-9 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: tx.iconBg, color: tx.iconColor }}
              >
                {tx.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-forest truncate">{tx.name}</p>
                <p className="text-[10px] text-muted-foreground">{tx.date}</p>
              </div>
              <p className={`text-xs font-bold flex-shrink-0 ${tx.amount > 0 ? "text-green-600" : "text-red-500"}`}>
                {tx.amount > 0 ? "+" : ""}${Math.abs(tx.amount)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Desktop Profile ──────────────────────────────────────────────────────────

export function DesktopProfile() {
  return (
    <div className="h-full overflow-y-auto scrollbar-hide bg-cream p-6">
      <h1 className="text-2xl font-extrabold text-forest mb-6">Profile</h1>

      <div className="grid grid-cols-3 gap-4">
        {/* Profile card */}
        <div className="bg-forest rounded-3xl p-6 flex flex-col items-center text-center">
          <div className="relative mb-3">
            <div className="w-20 h-20 rounded-3xl overflow-hidden ring-4 ring-lime/60">
              <img src="/images/onboarding-hero.jpg" alt="Alex Piter" className="w-full h-full object-cover object-top" />
            </div>
            <button className="absolute -bottom-1 -right-1 w-7 h-7 rounded-xl bg-lime flex items-center justify-center shadow-sm hover:scale-110 transition-transform">
              <Edit3 size={13} className="text-forest" />
            </button>
          </div>
          <p className="text-lg font-extrabold text-white mt-2">Alex Piter</p>
          <p className="text-xs text-white/50 mb-4">alex.piter@email.com</p>
          <div className="w-full space-y-2">
            <div className="flex justify-between items-center py-1.5 px-3 rounded-xl bg-white/5 text-xs">
              <span className="text-white/60">Member since</span>
              <span className="text-white font-semibold">Jan 2023</span>
            </div>
            <div className="flex justify-between items-center py-1.5 px-3 rounded-xl bg-white/5 text-xs">
              <span className="text-white/60">Account type</span>
              <span className="text-lime font-bold">Premium</span>
            </div>
            <div className="flex justify-between items-center py-1.5 px-3 rounded-xl bg-white/5 text-xs">
              <span className="text-white/60">KYC Status</span>
              <span className="text-green-400 font-semibold">Verified</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-3">
          {profileStats.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.label} className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-10 h-10 rounded-2xl bg-cream flex items-center justify-center flex-shrink-0">
                  <Icon size={16} className="text-forest" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  <p className="text-base font-extrabold text-forest">{s.value}</p>
                </div>
                <div
                  className="ml-auto text-[10px] font-bold px-2 py-1 rounded-lg"
                  style={{
                    background: s.up ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                    color: s.up ? "rgb(22,163,74)" : "rgb(239,68,68)",
                  }}
                >
                  {s.up ? "+" : "-"}
                </div>
              </div>
            )
          })}
        </div>

        {/* Settings menu */}
        <div className="bg-white rounded-3xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-forest mb-3">Settings</h3>
          <div className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon
              return (
                <button key={item.label} className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-cream transition-colors text-left">
                  <div className={`w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 ${item.danger ? "bg-red-50" : "bg-cream"}`}>
                    <Icon size={15} className={item.danger ? "text-red-500" : "text-forest"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${item.danger ? "text-red-500" : "text-forest"}`}>{item.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{item.sub}</p>
                  </div>
                  {!item.danger && <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
