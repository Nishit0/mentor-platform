import { Suspense } from "react";
import AuthPageClient from "@/components/AuthPageClient";

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-950 text-white"><p>Loading account...</p></main>}>
      <AuthPageClient />
    </Suspense>
  );
}
