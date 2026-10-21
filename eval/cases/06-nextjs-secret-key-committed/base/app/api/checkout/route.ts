import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const { lessonId } = await req.json();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: lessonId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/booked`,
    cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/lessons`,
  });
  return NextResponse.json({ url: session.url });
}
