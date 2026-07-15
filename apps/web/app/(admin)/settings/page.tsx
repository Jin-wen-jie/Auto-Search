export default function SettingsPage() {
  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-gray-900">系统设置</h2>
      <div className="max-w-md space-y-6">
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="mb-3 font-semibold text-gray-900">采集调度</h3>
          <div className="space-y-1.5 text-sm text-gray-700">
            <p>公开网页搜索：每 3 小时</p><p>候选链接验证：每批次</p><p>已通过商品价格：打开总览时刷新</p>
          </div>
          <p className="mt-2 text-xs text-gray-500">Bing RSS 无需密钥；Brave、Google 和 Serper 配置部署密钥后会并行搜索。单个引擎失败不会阻塞其他引擎。</p>
        </section>
      </div>
    </div>
  );
}
