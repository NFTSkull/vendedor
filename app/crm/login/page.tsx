"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function CrmLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    try {
      const res = await fetch("/api/crm/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setErrorMsg("Credenciales incorrectas");
        return;
      }

      const data = (await res.json()) as { token: string; nombre: string };
      localStorage.setItem("crm_token", data.token);
      router.push("/crm/leads?producto=generadores");
    } catch {
      setErrorMsg("No se pudo iniciar sesión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-sm p-6 md:p-8">
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 h-12 w-12 rounded-xl bg-blue-600 text-white grid place-items-center text-xl font-bold">
            M
          </div>
          <h1 className="text-2xl font-semibold">Mejoravit CRM</h1>
          <p className="text-sm text-slate-500 mt-1">Acceso para asesores</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Correo
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="admin@mejoravit.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {errorMsg ? <p className="text-sm text-red-600">{errorMsg}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Iniciar sesión"}
          </button>
        </form>
      </section>
    </main>
  );
}
