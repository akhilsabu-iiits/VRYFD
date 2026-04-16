"use client";

import React, { useState, useRef } from "react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface Props {
  onSuccess: () => void;
}

export default function OrganizerLogin({ onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");

    try {
      // Verify password against backend — if adminAuth accepts it, it's correct.
      // Using confirmAllAttendees with a non-existent event (returns empty results, no chain call).
      const res = await fetch(`${BACKEND}/api/relay/confirmAllAttendees`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": password },
        body: JSON.stringify({ onChainEventId: 0 }),
      });

      if (res.status === 401) {
        setError("Incorrect password");
        setShaking(true);
        setPassword("");
        setTimeout(() => setShaking(false), 400);
        setTimeout(() => inputRef.current?.focus(), 10);
        return;
      }

      // 200 or any non-401 response means the password was accepted by the backend
      sessionStorage.setItem("vryfd_org_authed", "1");
      sessionStorage.setItem("vryfd_org_secret", password);
      onSuccess();
    } catch {
      setError("Could not reach backend — check your connection");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="org-login">
      <div className={`org-login-card${shaking ? " org-login-shake" : ""}`}>
        <div className="org-login-icon">⚙</div>
        <h2 className="org-login-title">Organizer Access</h2>
        <p className="org-login-sub">Enter the organizer password to access the dashboard</p>
        <form className="org-login-form" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            className="org-input"
            placeholder="Password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            autoFocus
          />
          {error && <p className="org-login-error">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? "Verifying…" : "Unlock Dashboard →"}
          </button>
        </form>
      </div>
    </div>
  );
}
