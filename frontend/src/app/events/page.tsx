"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OldEventsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/marketplace");
  }, [router]);
  return null;
}
