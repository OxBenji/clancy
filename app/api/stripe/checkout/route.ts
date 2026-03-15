import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 500 }
    );
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return NextResponse.json(
      { error: "STRIPE_PRICE_ID is not configured" },
      { status: 500 }
    );
  }

  const { origin } = new URL(request.url);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/billing?success=true`,
    cancel_url: `${origin}/billing?canceled=true`,
    metadata: { clerk_user_id: userId },
    client_reference_id: userId,
  });

  return NextResponse.json({ url: session.url });
}
