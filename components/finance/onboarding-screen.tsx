"use client"

import { ArrowRight } from "lucide-react"

interface OnboardingScreenProps {
  onComplete: () => void
  currentSlide: number
  onSlideChange: (n: number) => void
}

const slides = [
  {
    headline: "All Your Finances. One Powerful Platform.",
    description:
      "Send, receive, and manage your money effortlessly fast, secure, and designed for everyday life.",
  },
  {
    headline: "Smart Tracking. Smarter Decisions.",
    description:
      "Visualize your spending, monitor income, and stay on top of every transaction with beautiful insights.",
  },
  {
    headline: "Send Money in Seconds.",
    description:
      "Instant transfers to friends and family. No fees, no fuss — just seamless payments at your fingertips.",
  },
]

export function OnboardingScreen({ onComplete, currentSlide, onSlideChange }: OnboardingScreenProps) {
  const slide = slides[currentSlide] ?? slides[0]
  const isLast = currentSlide === slides.length - 1

  const handleNext = () => {
    if (isLast) {
      onComplete()
    } else {
      onSlideChange(currentSlide + 1)
    }
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden select-none">
      {/* Hero Image */}
      <div className="relative flex-1 min-h-0">
        <img
          src="/images/onboarding-hero.jpg"
          alt="Woman confidently managing finances on her smartphone"
          className="w-full h-full object-cover object-top"
          draggable={false}
        />
        {/* Status bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 pt-3 pb-2">
          <span className="text-xs font-semibold text-white drop-shadow">9:41</span>
          <div className="flex items-center gap-1">
            <svg width="17" height="12" viewBox="0 0 17 12" fill="white">
              <rect x="0" y="3" width="3" height="9" rx="1" opacity="0.5"/>
              <rect x="4.5" y="2" width="3" height="10" rx="1" opacity="0.7"/>
              <rect x="9" y="0.5" width="3" height="11.5" rx="1" opacity="0.9"/>
              <rect x="13.5" y="0" width="3" height="12" rx="1"/>
            </svg>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="white">
              <path d="M8 2.4C10.5 2.4 12.7 3.5 14.2 5.2L15.5 3.8C13.6 1.7 11 0.4 8 0.4C5 0.4 2.4 1.7 0.5 3.8L1.8 5.2C3.3 3.5 5.5 2.4 8 2.4Z" opacity="0.4"/>
              <path d="M8 5.6C9.8 5.6 11.4 6.4 12.5 7.6L13.8 6.2C12.3 4.6 10.3 3.6 8 3.6C5.7 3.6 3.7 4.6 2.2 6.2L3.5 7.6C4.6 6.4 6.2 5.6 8 5.6Z" opacity="0.7"/>
              <path d="M8 8.8C9.1 8.8 10 9.3 10.7 10L8 12.8L5.3 10C6 9.3 6.9 8.8 8 8.8Z"/>
            </svg>
            <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
              <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="white" strokeOpacity="0.5"/>
              <rect x="1.5" y="1.5" width="16" height="9" rx="2.5" fill="white"/>
              <path d="M23 4v4a2 2 0 000-4z" fill="white" opacity="0.4"/>
            </svg>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-7 pt-6 pb-8 flex flex-col gap-4">
        <div className="text-center space-y-2">
          <h1 className="text-[22px] font-bold leading-tight text-forest text-balance">
            {slide.headline}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {slide.description}
          </p>
        </div>

        {/* Dots */}
        <div className="flex justify-center gap-2 py-1">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => onSlideChange(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === currentSlide ? "w-5 bg-forest" : "w-2 bg-forest/20"
              }`}
            />
          ))}
        </div>

        {/* Button */}
        <button
          onClick={handleNext}
          className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-forest text-white font-semibold text-base transition-all active:scale-[0.98]"
        >
          {isLast ? "Get Started" : "Next"}
          <ArrowRight size={18} />
        </button>

        {/* Home indicator */}
        <div className="flex justify-center pt-1">
          <div className="w-32 h-1 bg-foreground/20 rounded-full" />
        </div>
      </div>
    </div>
  )
}
