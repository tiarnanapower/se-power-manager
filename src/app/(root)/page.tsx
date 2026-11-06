import { redirect } from "next/navigation";
import { DEFAULT_PATH } from "@/components/shell/nav-items";

// Root alias for MOCK/STATIC development: lands on the first menu item.
export default function Page() {
  redirect(`/${DEFAULT_PATH}`);
}
