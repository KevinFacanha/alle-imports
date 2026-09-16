import type { Integration } from "@/types/integrations"

export const integrations: Integration[] = [
  { name: "Mercado Livre", status: "Conectado", backgroundClassName: "bg-[#fff1df]", initials: "ML" },
  { name: "Shopee", status: "Conectado", backgroundClassName: "bg-[#ffe8e8]", initials: "S" },
  { name: "Olist / Tiny", status: "Desconectado", backgroundClassName: "bg-[#edf0f5]", initials: "OT" },
  { name: "GeFinance", status: "Conectado", backgroundClassName: "bg-[#e5f7ee]", initials: "GF" },
  { name: "M10", status: "Desconectado", backgroundClassName: "bg-[#edf0f5]", initials: "M10" },
]
