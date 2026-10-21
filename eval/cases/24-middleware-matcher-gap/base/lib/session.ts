import type { NextRequest } from "next/server";
export function hasStaffSession(req: NextRequest): boolean {
  const v = req.cookies.get("shiftly_staff")?.value;
  return !!v && v.length > 20;
}
