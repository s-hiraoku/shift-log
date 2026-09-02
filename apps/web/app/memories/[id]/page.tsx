import MemoryDetailClient from "./MemoryDetailClient";

/**
 * Memory IDs are only known at runtime. For the desktop static export we
 * emit one placeholder page so the route is present in the client router;
 * real IDs are resolved via client-side (SPA) navigation and fetched at
 * runtime. In the web build, non-listed IDs are served dynamically.
 */
export function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function MemoryDetailPage() {
  return <MemoryDetailClient />;
}
