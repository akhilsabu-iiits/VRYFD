import { request, APIRequestContext } from "@playwright/test";
import { CONFIG } from "./config";

export async function loginAs(
  api: APIRequestContext,
  email: string,
  password: string
): Promise<{ token: string; user: any }> {
  const res = await api.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`Login failed for ${email}: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return { token: body.token, user: body.user };
}

export async function withAuth(token: string) {
  return await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchEvents(api: APIRequestContext) {
  const res = await api.get(`${CONFIG.BACKEND_URL}/api/relay/events`);
  if (!res.ok()) throw new Error(`Failed to fetch events: ${res.status()}`);
  const body = await res.json();
  return body.events as any[];
}

export function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function nowPlus(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}
