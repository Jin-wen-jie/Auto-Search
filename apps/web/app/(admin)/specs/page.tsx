import { DataTable, type Column } from "../../../components/data-table";
import { listSpecViews } from "../../../lib/admin-read-repository";

type ProductSpec = Awaited<ReturnType<typeof listSpecViews>>[number];

const columns: Column<ProductSpec>[] = [
  { key: "provider", header: "产品商", render: (row) => <span className="font-semibold text-gray-900">{row.provider}</span> },
  { key: "productLine", header: "产品线", render: (row) => <span className="text-gray-800">{row.productLine}</span> },
  { key: "plan", header: "套餐", render: (row) => <span className="text-gray-800">{row.plan}</span> },
  { key: "delivery", header: "交付方式", render: (row) => <span className="text-gray-700">{row.delivery}</span> },
  { key: "accessMode", header: "访问模式", render: (row) => <span className="text-gray-700">{row.accessMode}</span> },
  { key: "validity", header: "有效期", render: (row) => <span className="text-gray-700">{row.validity}</span> },
  { key: "key", header: "比较键", render: (row) => <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{row.comparisonKey}</code> },
];

export default async function SpecsPage() {
  const rows = await listSpecViews();
  return (
    <div>
        <h2 className="mb-1 text-xl font-bold text-gray-900">K12 / Bug Team 规格管理</h2>
      <p className="mb-4 text-xs text-gray-500">规格只能由人工审核后的完整字段生成；空白候选不会自动进入比较集合。</p>
      <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
    </div>
  );
}
