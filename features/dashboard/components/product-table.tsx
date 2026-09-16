import { products } from "@/mocks/products"

export function ProductTable() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-bold">Produtos sem giro</h3>
          <p className="mt-1 text-xs text-slate-400">Sem vendas há mais de 60 dias</p>
        </div>
        <button className="text-xs font-bold text-[#6254d9]">Ver todos</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="pb-3">Produto</th>
              <th className="pb-3">Estoque</th>
              <th className="pb-3">Dias</th>
              <th className="pb-3">Margem</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.sku} className="border-b border-slate-50 last:border-0">
                <td className="py-3">
                  <b className="block">{product.name}</b>
                  <span className="text-[10px] text-slate-400">{product.sku}</span>
                </td>
                <td>{product.stock}</td>
                <td className="font-bold text-rose-500">{product.days}d</td>
                <td>{product.margin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
