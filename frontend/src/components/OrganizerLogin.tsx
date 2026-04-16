"use client";

import React, { useState, useRef } from "react";

interface Props {
  onSuccess: () => void;
}

export default function OrganizerLogin({ onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const secret = process.env.NEXT_PUBLIC_ADMIN_SECRET;
    if (!secret) {
      setError("Admin secret not configured on this deployment");
      return;
    }
    if (password === secret) {
      sessionStorage.setItem("vryfd_org_authed", "1");
      onSuccess();
    } else {
      setError("Incorrect password");
      setShaking(true);
      setPassword("");
      setTimeout(() => setShaking(false), 400);
      setTimeout(() => inputRef.current?.focus(), 10);
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
          <button type="submit" className="btn btn-primary btn-block">
            Unlock Dashboard →
          </button>
        </form>
      </div>
    </div>
  );
}
