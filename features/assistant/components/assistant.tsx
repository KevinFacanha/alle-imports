"use client"

import { Bot, ChevronRight, Send, Sparkles } from "lucide-react"

import { useAssistant } from "@/features/assistant/components/assistant-provider"
import { assistantSuggestions } from "@/mocks/chat-messages"

export function Assistant() {
  const { input, setInput, messages, ask } = useAssistant()

  return (
    <div className="mx-auto flex min-h-[calc(100vh-136px)] max-w-[900px] flex-col">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#eeecff] px-3 py-1.5 text-[11px] font-bold text-[#6254d9]">
            <Bot size={14} /> GABI · Inteligência Comercial
          </div>
          <h2 className="max-w-xl text-3xl font-bold leading-tight tracking-[-.04em] sm:text-4xl">
            Sua operação, agora <span className="text-[#6254d9]">mais inteligente.</span>
          </h2>
          <p className="mt-3 text-sm text-slate-500">
            Converse com seus dados e tome decisões melhores em poucos segundos.
          </p>
        </div>
        <div className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-right sm:block">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dados atualizados</p>
          <p className="mt-1 flex items-center gap-1 text-xs font-bold text-emerald-600">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Agora mesmo
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex-1 overflow-auto p-5 sm:p-8">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`mb-6 flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}
            >
              {message.role === "ai" && (
                <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#6254d9] text-white">
                  <Sparkles size={15} />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-[#f1f0ff] text-slate-700" : "bg-slate-50 text-slate-600"}`}
              >
                {message.text}
              </div>
            </div>
          ))}
          {messages.length === 1 && (
            <div className="mt-10 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {assistantSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => ask(suggestion)}
                  className="group flex items-center justify-between rounded-xl border border-slate-200 p-3 text-left text-xs font-semibold text-slate-600 transition hover:border-[#bdb7ff] hover:bg-[#faf9ff]"
                >
                  <span>{suggestion}</span>
                  <ChevronRight
                    size={15}
                    className="text-slate-300 transition group-hover:text-[#6254d9]"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-slate-100 p-4">
          <div className="flex items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-2 pl-4 focus-within:border-[#928bdf] focus-within:ring-4 focus-within:ring-indigo-50">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault()
                  ask()
                }
              }}
              placeholder="Pergunte qualquer coisa sobre sua operação..."
              rows={2}
              className="min-h-12 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-slate-400"
            />
            <button
              onClick={() => ask()}
              aria-label="Enviar pergunta"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#6254d9] text-white transition hover:bg-[#5145c0]"
            >
              <Send size={16} />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-slate-400">
            <span>Pressione Enter para enviar · Shift + Enter para nova linha</span>
            <span className="hidden sm:block">GABI pode cometer erros. Confira dados importantes.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
