import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    await requireAdmin();
  } catch (res) {
    return res as Response;
  }
  const users = await db.user.findMany({ select: { id: true, email: true, name: true, role: true } });
  return NextResponse.json(users);
}
