import { SEGMENT_ID } from "@/lib/audiences/segment-types";

// A promotion's `customer.segments` value isn't strictly typed in our model, so
// this reads it defensively: any segment UUID found is an include, unless it
// sits under a key that looks like an exclusion ("exclude", "excluded", "not").
export function extractSegmentIds(value: unknown): { include: string[]; exclude: string[] } {
  const include = new Set<string>();
  const exclude = new Set<string>();

  const walk = (node: unknown, excluded: boolean, depth: number) => {
    if (depth > 6 || node === null || node === undefined) return;

    if (typeof node === "string") {
      if (SEGMENT_ID.test(node)) (excluded ? exclude : include).add(node.toLowerCase());

      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item, excluded, depth + 1);

      return;
    }

    if (typeof node === "object") {
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        walk(item, excluded || /exclu|^not$|negat/i.test(key), depth + 1);
      }
    }
  };

  walk(value, false, 0);

  return { include: [...include], exclude: [...exclude] };
}
