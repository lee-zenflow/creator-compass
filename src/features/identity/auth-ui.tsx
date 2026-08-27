"use client";

import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { CompassMark } from "@/components/ui/compass-mark";
import { AUTH_SUCCESS_TARGET } from "./navigation";

const subscribeToHydration = () => () => undefined;

function useHydrated() {
  return useSyncExternalStore(subscribeToHydration, () => true, () => false);
}

type AuthFrameProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthFrame({ title, description, children }: AuthFrameProps) {
  return (
    <main className="auth-shell">
      <header className="auth-bar">
        <Link href="/" aria-label="返回入口">
          <CompassMark decorative size="small" />
        </Link>
        <span>Creator Compass</span>
      </header>
      <section className="auth-panel">
        <div className="auth-heading">
          <p className="auth-kicker">CREATOR COMPASS</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children}
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  minLength,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: "text" | "password";
  autoComplete?: string;
  minLength?: number;
  defaultValue?: string;
}) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input
        className="auth-input"
        name={name}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        defaultValue={defaultValue}
        required
      />
    </label>
  );
}

function FormMessage({ message, error }: { message?: string; error?: string }) {
  if (!message && !error) return null;
  return (
    <p className="auth-message" role="status" data-error={Boolean(error)}>
      {error ?? message}
    </p>
  );
}

export function LoginForm({ ownerName }: { ownerName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const ready = useHydrated();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/identity/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: String(data.get("username")),
          password: String(data.get("password")),
        }),
      });
      if (!response.ok) {
        setError("用户名或密码不正确。");
        return;
      }
      window.location.assign(AUTH_SUCCESS_TARGET);
    } catch {
      setError("本地服务暂时不可用，请确认应用仍在运行。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <Field label="用户名" name="username" autoComplete="username" defaultValue={ownerName} />
      <Field label="密码" name="password" type="password" autoComplete="current-password" />
      <FormMessage error={error} />
      <Button className="auth-submit" type="submit" disabled={pending || !ready}>
        {pending ? "登录中…" : "登录"}
      </Button>
      <div className="auth-links auth-links--single">
        <Link href="/recovery">使用恢复码重置密码</Link>
      </div>
    </form>
  );
}

export function LocalSetupForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const ready = useHydrated();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/identity/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: String(data.get("username")),
          password: String(data.get("password")),
        }),
      });
      const payload = (await response.json()) as { recoveryCodes?: string[] };
      if (!response.ok || !payload.recoveryCodes?.length) {
        setError(response.status === 409 ? "本地 Owner 已创建，请直接登录。" : "初始化失败，请检查输入后重试。");
        return;
      }
      setRecoveryCodes(payload.recoveryCodes);
    } catch {
      setError("本地服务暂时不可用，请确认应用仍在运行。");
    } finally {
      setPending(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="auth-form">
        <FormMessage message="恢复码只展示这一次。请离线保存，不要截图上传到云端。" />
        <ol className="auth-recovery-codes" aria-label="一次性恢复码">
          {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
        </ol>
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigator.clipboard?.writeText(recoveryCodes.join("\n"))}
        >
          复制全部恢复码
        </Button>
        <div className="auth-links auth-links--single">
          <Link href="/login">我已保存，去登录</Link>
        </div>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <Field label="用户名" name="username" autoComplete="username" />
      <Field label="密码" name="password" type="password" autoComplete="new-password" minLength={10} />
      <p className="auth-hint">至少 10 位。此设备只允许创建一个 Owner。</p>
      <p className="auth-policy-copy">
        初始化前，请阅读<Link href="/terms">用户协议</Link>和<Link href="/privacy">隐私说明</Link>。
      </p>
      <FormMessage error={error} />
      <Button className="auth-submit" type="submit" disabled={pending || !ready}>
        {pending ? "创建中…" : "创建本地 Owner"}
      </Button>
    </form>
  );
}

export function LocalRecoveryForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const ready = useHydrated();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/identity/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: String(data.get("code")),
          password: String(data.get("password")),
        }),
      });
      if (!response.ok) {
        setError("恢复码无效、已使用，或新密码不符合要求。");
        return;
      }
      setMessage("密码已更新，这枚恢复码已失效。");
    } catch {
      setError("本地服务暂时不可用，请确认应用仍在运行。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <Field label="恢复码" name="code" autoComplete="one-time-code" />
      <Field label="新密码" name="password" type="password" autoComplete="new-password" minLength={10} />
      <FormMessage message={message} error={error} />
      <Button className="auth-submit" type="submit" disabled={pending || !ready}>
        {pending ? "重置中…" : "重置密码"}
      </Button>
      <div className="auth-links auth-links--single">
        <Link href="/login">返回登录</Link>
      </div>
    </form>
  );
}
