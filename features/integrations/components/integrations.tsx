import { PlugZap, Settings2 } from "lucide-react"

import { integrations } from "@/mocks/integrations"

export function Integrations() {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[.15em] text-[#6254d9]">Ecossistema</p>
        <h2 className="text-3xl font-bold tracking-[-.04em]">Integrações</h2>
        <p className="mt-2 text-sm text-slate-500">Conecte suas ferramentas para uma visão unificada.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {integrations.map(({ name, status, backgroundClassName, initials }) => (
          <div key={name} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <div className={`grid size-11 place-items-center rounded-xl text-xs font-black ${backgroundClassName}`}>
                {initials}
              </div>
              <div className="flex-1">
                <h3 className="font-bold">{name}</h3>
                <p
                  className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${status === "Conectado" ? "text-emerald-600" : "text-slate-400"}`}
                >
                  <span
                    className={`size-1.5 rounded-full ${status === "Conectado" ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                  {status}
                </p>
              </div>
              <button className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:text-[#6254d9]">
                <Settings2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[#bdb7ff] bg-[#faf9ff] p-5 text-sm text-slate-600">
        <PlugZap className="text-[#6254d9]" size={20} />
        <span>
          <b>Precisa de outra integração?</b> Fale com nosso time para conectar sua ferramenta.
        </span>
        <button className="ml-auto text-xs font-bold text-[#6254d9]">Solicitar</button>
      </div>
    </div>
  )
}
