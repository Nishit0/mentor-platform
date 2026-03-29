import type { User } from "@supabase/supabase-js";

export type AppRole = "mentor" | "student";

export function getUserRole(user: User | null | undefined): AppRole | null {
  const role = user?.user_metadata?.role;
  return role === "mentor" || role === "student" ? role : null;
}

export function getUserDisplayName(user: User | null | undefined) {
  const fullName = user?.user_metadata?.full_name;
  if (typeof fullName === "string" && fullName.trim().length > 0) {
    return fullName.trim();
  }

  if (typeof user?.email === "string") {
    return user.email;
  }

  return "User";
}

export function slugifyRoomId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createRoomId() {
  return `session-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeDuration(value: number) {
  if (!Number.isFinite(value) || value < 15) {
    return 60;
  }

  return Math.min(180, Math.round(value));
}
