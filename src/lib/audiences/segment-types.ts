// Customer segments (Segmentation API, an Enterprise feature). Pure types so
// both the server and the browser can use them.
export interface SegmentSummary {
  id: string;
  name: string;
  description: string;
  createdAt: string | null;
  // null when unknown (the member-count call needs the Customers: modify scope).
  memberCount: number | null;
}

export type SegmentsResult = { available: true; items: SegmentSummary[] } | { available: false; message: string };

export const SEGMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
