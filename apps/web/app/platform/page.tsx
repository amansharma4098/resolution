"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PlatformIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/platform/tenants");
  }, [router]);
  return null;
}
