"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = (await res.json()) as { ok?: boolean; error?: string; forcePasswordChange?: boolean };
      if (!res.ok || data.error) { setError(data.error ?? "登录失败"); return; }
      if (data.forcePasswordChange) { router.push("/settings?forcePasswordChange=1"); } else { router.push("/dashboard"); }
    } catch { setError("网络错误，请重试"); } finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-lg border border-gray-200">
        <h1 className="mb-1 text-center text-xl font-bold text-gray-900">K12 / Bug Team 比价后台</h1>
        <p className="mb-6 text-center text-sm text-gray-500">教育 AI 商品公开链接调查系统</p>
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{error}</div>}
        <label className="mb-3 block">
          <span className="text-sm font-semibold text-gray-800">用户名</span>
          <input type="text" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="mb-5 block">
          <span className="text-sm font-semibold text-gray-800">密码</span>
          <input type="password" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">{loading ? "登录中…" : "登录"}</button>
      </form>
    </div>
  );
}
